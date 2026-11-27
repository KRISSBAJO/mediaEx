import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pool } from '../backend/auth.mts'
import { getAssetRow, newAssetId, prefixOf } from '../backend/media/assets.mts'
import { handleMedia } from '../backend/media/routes.mts'
import { reviewAsset } from '../backend/media/reviews.mts'
import { purgeExpiredTrash, recovery } from '../backend/media/recovery.mts'

// Run against a migrated disposable Postgres instance. All mutations are scoped to a random fixture workspace.
test('trash, recovery and replacement preserve bytes, metadata and permissions', { skip: !process.env.DATABASE_URL }, async (t) => {
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname), 'Use a local test database')
  const org = 'recovery-test-' + randomUUID()
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mediaex-recovery-'))
  process.env.MEDIA_DIR = dir
  process.env.MEDIA_WORKER = 'off'
  const a = newAssetId(), b = newAssetId()
  const manager = { orgId: org, role: 'owner', via: 'session', scope: 'full', userId: 'test-owner' }
  async function api(path, method = 'GET', key = '', body) {
    const req = new Request('http://localhost' + path, { method, headers: key ? { Authorization: 'Bearer ' + key, 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    const result = await handleMedia(req, path)
    return { status: result.status, body: result.headers.get('content-type')?.includes('json') ? await result.json() : await result.text() }
  }
  async function makeKey(scope) {
    const key = 'mx_live_' + randomBytes(16).toString('hex')
    const id = 'key_' + randomUUID()
    await pool.query('insert into api_key (id,"organizationId",name,scope,hash,last4) values ($1,$2,$3,$4,$5,$6)',
      [id, org, scope, scope, createHash('sha256').update(key).digest('hex'),key.slice(-4)])
    return { key, id }
  }
  async function version(id, label, policy) {
    const prefix = org + '/' + id
    const buffer = Buffer.from(label)
    await mkdir(path.join(dir, prefix, 'captions'), {recursive:true})
    await writeFile(path.join(dir, prefix,'original.png'),buffer)
    await writeFile(path.join(dir, prefix,'thumb.jpg'),label)
    await writeFile(path.join(dir,prefix,'captions/en.vtt'),'WEBVTT\n'+label)
    await pool.query(`insert into asset (id,"organizationId",title,type,status,"fileName","originalKey",size,"storageBackend",playback,metadata,tags,"thumbKey")
      values ($1,$2,$3,'image','ready',$4,$5,$6,'local',$7,$8,$9,$10)`,[id,org,label,label+'.png',prefix+'/original.png',buffer.length,policy,JSON.stringify({ field:label }),[label],prefix+'/thumb.jpg'])
    await pool.query(`insert into caption ("assetId",lang,label,key) values ($1,'en',$2,$3)`,[id,label,prefix+'/captions/en.vtt'])
  }
  try {
    await pool.query('insert into organization (id,name,slug,"createdAt") values ($1,$1,$1,now())',[org])
    const {key,id:keyId} = await makeKey('full')
    const limited = (await makeKey('read')).key
    await version(a,'original','signed')
    await version(b,'replacement','public')
    const strict = { kinds:['image'],maxBytes:1024,maxSourceEdge:null,maxShortSide:null,maxDuration:null,review:true,playback:'signed' }
    await pool.query('update asset set "uploadPolicy"=$2 where id=$1',[a,JSON.stringify(strict)])
    const root = '/api/v1/assets/'+a
    const original = await getAssetRow(a,org), next = await getAssetRow(b,org)
    const {revisionId} = original
    // A verified bucket migration was rolled back to disk. Both generations still exist.
    const backupKey = next.originalKey
    const bucketObjects = new Set([backupKey])
    Object.assign(process.env,{ S3_BUCKET:'fixture', S3_REGION:'us-east-1', S3_ENDPOINT:'https://recovery-fixture.example.test',
      S3_ACCESS_KEY_ID:'fixture', S3_SECRET_ACCESS_KEY:'fixture', S3_SESSION_TOKEN:'' })
    t.mock.method(globalThis,'fetch',async (request) => {
      const url = new URL(request.url)
      assert.equal(url.hostname,'recovery-fixture.example.test')
      if (request.method === 'DELETE') {
        assert.equal(decodeURIComponent(url.pathname),'/fixture/'+backupKey)
        bucketObjects.delete(backupKey)
        return new Response(null,{status:204})
      }
      assert.equal(url.searchParams.get('prefix'),prefixOf(next)+'/')
      return new Response('<ListBucketResult>' + [...bucketObjects].map(key => '<Contents><Key>'+key+'</Key></Contents>').join('') + '</ListBucketResult>')
    })
    await pool.query(`insert into media_store_transfer ("assetId","organizationId","revisionId",prefix,digest,objects,bytes,"rolledBackAt")
      values ($1,$2,$3,$4,'verified-fixture',1,$5,now())`, [b,org,next.revisionId,prefixOf(next),next.size])
    const post = body => api(root+'/revisions','POST',key,body)
    assert.equal((await api(root+'/revisions','GET',limited)).status,403)
    assert.equal((await api(root+'/restore','POST',limited)).status,403)
    await assert.rejects(recovery({...manager,role:'member'},new Request('http://localhost'),undefined,'trash'),e=>e.status===403)
    await assert.rejects(recovery({...manager,orgId:org+'other'},new Request('http://localhost'),a,'revisions'),e=>e.status===404)
    const publish = { expectedCurrent:revisionId, replacementId:b }
    const reviewPath = '/api/v1/assets/'+b+'/review'
    const submit = { action:'submit',revisionId:next.revisionId,expectedEvent:null,comment:'New event cover' }
    assert.equal((await api(reviewPath,'POST',limited,submit)).status,403)
    const submitted = await api(reviewPath,'POST',key,submit)
    assert.equal(submitted.status,200)
    assert.equal((await api(reviewPath,'POST',key,submit)).status,409)
    publish.expectedReplacementRevision = next.revisionId
    assert.equal((await post(publish)).status,409)
    const decision = { ...submit, action:'request_changes',expectedEvent:submitted.body.latest.id,comment:'Adjust crop' }
    assert.equal((await api(reviewPath,'POST',key,decision)).status,403)
    const decide = async (body, actor=manager) => (await reviewAsset(actor,new Request('http://localhost',{method:'POST',body:JSON.stringify(body)}),b)).json()
    const changes = await decide(decision)
    const resubmitted = await decide({...submit,expectedEvent:changes.latest.id})
    const approval = {...decision,action:'approve',expectedEvent:resubmitted.latest.id}
    await assert.rejects(decide(approval),e=>e.status===403)
    const reviewer = {...manager,userId:'independent-reviewer'}
    const approved = await decide(approval,reviewer)
    assert.equal(approved.history.length,4)
    assert.equal(approved.latest.state,'approved')
    assert.equal((await post({...publish,expectedReplacementRevision:revisionId})).status,409)
    await pool.query('update caption set status=\'processing\' where "assetId"=$1',[a])
    assert.equal((await post(publish)).status,409)
    await pool.query('update caption set status=\'ready\' where "assetId"=$1',[a])
    assert.equal((await post(publish)).status,409)
    assert.equal((await getAssetRow(a,org)).revisionId,revisionId)
    await pool.query('insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt") values ($1,$1,$2,true,now(),now())',[org,org+'@example.test'])
    await pool.query('update asset set moderation=\'approved\',"moderatedBy"=$2 where id=$1',[b,org])
    assert.equal((await post(publish)).status,200)
    assert.equal(await getAssetRow(b,org),null)
    assert.equal((await pool.query('select "assetId" from media_store_transfer where "revisionId"=$1',[next.revisionId])).rows[0].assetId,a)
    const current = await getAssetRow(a,org)
    assert.equal(current.revisionId,next.revisionId)
    assert.equal(current.playback,'signed')
    assert.equal(current.moderation,'approved')
    assert.deepEqual(current.uploadPolicy,strict)
    assert.equal((await api(root,'PATCH',key,{playback:'public'})).status,409)
    assert.equal((await api(root,'PATCH',key,{title:'corrected title'})).status,200)
    assert.equal(prefixOf(current),prefixOf(next))
    assert.equal(await readFile(path.join(dir,current.originalKey),'utf8'),'replacement')
    assert.equal((await api('/api/media/'+a+'/thumb.jpg')).status,404)
    assert.equal((await post(publish)).status,409)
    const restored = { expectedCurrent:next.revisionId, restoreRevisionId:revisionId }
    await rm(path.join(dir,original.originalKey))
    assert.equal((await post(restored)).status,409)
    assert.equal((await getAssetRow(a,org)).revisionId,next.revisionId)
    await writeFile(path.join(dir,original.originalKey),'original')
    assert.equal((await post(restored)).status,200)
    assert.equal((await post(restored)).status,200)
    const old = await getAssetRow(a,org)
    assert.equal(await readFile(path.join(dir,old.originalKey),'utf8'),'original')
    assert.equal(old.captions[0].label,'original')
    assert.deepEqual(old.metadata,{field:'original'})
    assert.deepEqual(old.tags,['original'])
    assert.equal((await api(root,'DELETE',key)).status,204)
    assert.equal((await api(root,'GET',key)).status,404)
    assert.equal((await api('/api/v1/assets/trash','GET',key)).body.assets[0].id,a)
    assert.equal((await api('/api/media/'+a+'/info')).status,404)
    assert.equal((await api('/api/media/'+a+'/captions/en.vtt')).status,404)
    assert.equal((await api(root+'/restore','POST',key)).status,200)
    assert.equal((await api(root+'/restore','POST',key)).status,200)
    const events = (await api(root+'/revisions','GET',key)).body.history
    assert.equal(events.filter(e=>e.action==='restored').length,1)
    assert.ok(events.every(e=>e.actor==='key:'+keyId))
    assert.equal((await api(root,'DELETE',key)).status,204)
    await pool.query(`update asset set "deletedAt"=now()-interval '31 days' where id=$1`,[a])
    assert.equal((await api(root+'/restore','POST',key)).status,410)
    // A conflicting logical reference blocks every deletion before any store is touched.
    const other = newAssetId()
    await pool.query(`insert into asset (id,"organizationId",title,type,status,"fileName","originalKey",size,"storageBackend")
      values ($1,$2,'overlap','image','ready','overlap.png',$3,1,'local')`,[other,org,backupKey])
    await assert.rejects(purgeExpiredTrash(org), AggregateError)
    assert.equal(bucketObjects.size,1)
    assert.equal(await readFile(path.join(dir,original.originalKey),'utf8'),'original')
    await pool.query('delete from asset where id=$1',[other])
    await pool.query('update asset set "trashRetryAt"=null where id=$1',[a])
    await purgeExpiredTrash(org)
    assert.equal(bucketObjects.size,0)
    assert.equal((await pool.query('select 1 from media_store_transfer where "assetId"=$1',[a])).rowCount,0)
    assert.equal((await pool.query('select id from asset where id=$1',[a])).rowCount,0)
    await assert.rejects(readFile(path.join(dir,old.originalKey)),{code:'ENOENT'})
    await assert.rejects(readFile(path.join(dir,next.originalKey)),{code:'ENOENT'})
    assert.equal((await pool.query('select * from asset_recovery_event where "assetId"=$1 and action=\'expired\'',[a])).rowCount,1)
  } finally {
    await pool.query('delete from organization where id=$1',[org])
    await pool.query('delete from "user" where id=$1',[org])
    await pool.end()
    await rm(dir,{recursive:true,force:true})
  }
})
