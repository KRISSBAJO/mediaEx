import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { auth, pool } from '../backend/auth.mts'
import { handleMedia } from '../backend/media/routes.mts'
import { parsePreset, checkProbedPolicy } from '../backend/media/presets.mts'
import { storage } from '../backend/media/storage.mts'
import { inspectUpload } from '../backend/media/worker.mts'
import { PLANS } from '../backend/media/billing.mts'

const base = { name: 'Reviewed images', folderId: null, isDefault: true, policy: {
  kinds: ['image'], maxBytes: 1024, review: true, playback: 'signed', maxShortSide: 720, maxSourceEdge: 256, maxDuration: 5,
} }

test('preset limits apply to measured media', () => {
  const draft = parsePreset(base)
  for (const [info, bytes] of [
    [{ type: 'video', width: 3, height: 2, duration: 0 }, 100],
    [{ type: 'image', width: 257, height: 2, duration: 0 }, 100],
    [{ type: 'image', width: 3, height: 2, duration: 6 }, 100],
    [{ type: 'image', width: 3, height: 2, duration: 0 }, 1025],
  ]) assert.throws(() => checkProbedPolicy(draft.policy, info, bytes))
  assert.doesNotThrow(() => checkProbedPolicy(draft.policy, { type: 'image', width: 256, height: 1, duration: 0 }, 1024))
  assert.throws(() => parsePreset({ ...base, policy: { ...base.policy, maxBytes: 0 } }))
})

test('the processing worker verifies original contents under a misleading filename', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'mx-probe-'))
  t.after(() => rm(temp, {recursive:true,force:true}))
  const file = path.join(temp, 'recording.mp4')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOkB+l8AAAAASUVORK5CYII=', 'base64')
  await writeFile(file, png)
  const job = {size: png.length, uploadPolicy: base.policy, type: 'video'}
  assert.equal((await inspectUpload(file,job)).info.type,'image')
  await assert.rejects(inspectUpload(file,{...job,uploadPolicy:{...base.policy,kinds:['video']}}), /media type/)
  await assert.rejects(inspectUpload(file,{...job,size:png.length + 1}), /bytes/)
})

test('bucket grants bind byte lengths, and single uploads can only create an original', async () => {
  Object.assign(process.env, { S3_BUCKET: 'test', S3_ENDPOINT: 'https://s3.example.test', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test' })
  const store = storage({storageBackend: 's3'})
  const single = await store.uploadTarget('org/asset/original.jpg', 'asset', 1024)
  const part = await store.partTarget('org/asset/original.jpg', 'upload-fixture', 1, 'asset', 256)
  assert.equal(single.headers['If-None-Match'], '*')
  assert.match(new URL(single.url).searchParams.get('X-Amz-SignedHeaders'), /content-length;host;if-none-match/)
  assert.match(new URL(part.url).searchParams.get('X-Amz-SignedHeaders'), /content-length;host/)
})

test('workspace administration, public API enforcement, expiry, and parallel admission', async t => {
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname), 'Use a migrated local test database')
  const org = 'p-' + randomUUID().slice(0,13)
  const other = 'preset-test-' + randomUUID()
  const user = 'user-' + randomUUID()
  const folder = 'fld_' + randomUUID().replaceAll('-', '').slice(0,10)
  const temp = await mkdtemp(path.join(process.cwd(), '.test-uploads-'))
  Object.assign(process.env, { MEDIAEX_S3_WORKSPACE_IDS: '', MEDIAEX_LEGACY_STORAGE: 'local', MEDIA_WORKER: 'off', MEDIA_DIR: temp })
  t.after(async () => {
    await pool.query('delete from organization where id=any($1::text[])', [[org,other]])
    await pool.query('delete from "user" where id=$1', [user])
    await pool.end()
    await rm(temp, { recursive: true, force: true })
  })
  for (const id of [org,other]) await pool.query('insert into organization (id,name,slug,"createdAt") values ($1,$1,$1,now())', [id])
  await pool.query('insert into "user" (id,name,email,"emailVerified") values($1,$1,$2,false)', [user, user+'@example.test'])
  await pool.query('insert into member(id,"organizationId","userId",role,"createdAt") values ($1,$2,$3,\'owner\',now()),($4,$5,$3,\'owner\',now())', [randomUUID(),org,user,randomUUID(),other])
  await pool.query('insert into folder(id,"organizationId",name) values ($1,$2,\'Destination\')', [folder,org])
  let active = org
  t.mock.method(auth.api, 'getSession', async () => ({ user: {id:user}, session: {activeOrganizationId:active} }))
  async function call(method, url, data, expected, key) {
    const res = await handleMedia(new Request('http://localhost' + url, { method,
      headers: { ...(key && { Authorization: 'Bearer '+key }), 'Content-Type': 'application/json' },
      ...(data !== undefined && {body: typeof data === 'string' ? data : JSON.stringify(data)}),
    }), url)
    const json = await res.json().catch(() => null)
    assert.equal(res.status, expected, method+' '+url+' '+JSON.stringify(json))
    return json
  }
  const saved = (await call('POST','/api/uploads/presets',{ ...base, folderId:folder },201)).preset
  assert.equal((await call('GET','/api/uploads/presets',undefined,200)).presets[0].id,saved.id)
  const key = (await call('POST','/api/keys',{name:'preset-qa',scope:'upload'},201)).secret
  assert.equal((await call('GET','/api/v1/uploads/presets',undefined,200,key)).presets[0].id,saved.id)
  await call('POST','/api/v1/uploads',{fileName:'large.jpg',size:1025},413,key)
  await call('POST','/api/uploads',{fileName:'video.mp4',size:100},415)
  await call('POST','/api/uploads',{fileName:'image.jpg',size:12.2},400)
  const session = await call('POST','/api/v1/uploads',{fileName:'photo.jpg',size:3,folderId:null,multipart:true},201,key)
  const upload = '/api/v1/uploads/'+session.asset.id
  assert.equal(session.asset.folderId,folder)
  assert.equal(session.asset.playback,'signed')
  assert.equal(session.asset.moderation,'pending')
  await call('POST',upload+'/parts',{numbers:[1]},200,key)
  await call('PUT',upload+'/parts/1','1234',400,key)
  await call('PUT',upload+'/parts/1','123',200,key)
  await Promise.all([call('POST',upload+'/complete',undefined,200,key),call('POST',upload+'/complete',undefined,200,key)])
  assert.equal((await pool.query('select status,"uploadExpiresAt" from asset where id=$1',[session.asset.id])).rows[0].uploadExpiresAt,null)
  await call('PATCH','/api/assets/'+session.asset.id,{playback:'public'},409)
  const abandoned = await call('POST','/api/uploads',{fileName:'old.jpg',size:3},201)
  await pool.query('update asset set "uploadExpiresAt"=now()-interval \'1 second\' where id=$1',[abandoned.asset.id])
  await call('PUT','/api/uploads/'+abandoned.asset.id,'123',410)
  await call('POST','/api/uploads/'+abandoned.asset.id+'/complete',undefined,410)

  active=other
  await call('POST','/api/uploads',{fileName:'photo.jpg',size:3,presetId:saved.id},404)
  await call('POST','/api/uploads/presets',{...base,folderId:folder},404)
  active=org
  await pool.query("update member set role='member' where \"organizationId\"=$1",[org])
  await call('DELETE','/api/uploads/presets/'+saved.id,undefined,403)
  await pool.query("update member set role='admin' where \"organizationId\"=$1",[org])
  await call('PUT','/api/uploads/presets/'+saved.id,{...base,name:'Edited',isDefault:false},200)
  await call('DELETE','/api/uploads/presets/'+saved.id,undefined,204)
  assert.equal((await call('GET','/api/uploads/presets/activity',undefined,200)).events.length,3)
  assert.deepEqual((await pool.query('select "uploadPolicy" from asset where id=$1',[session.asset.id])).rows[0].uploadPolicy,saved.policy)
  await pool.query("update asset set status='ready',size=$2 where id=$1",[session.asset.id,PLANS.creator.storageBytes-10])
  const responses = await Promise.all([1,2].map(() => handleMedia(new Request('http://localhost/api/uploads', {method:'POST',body:JSON.stringify({fileName:'photo.jpg',size:10})}), '/api/uploads')))
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,402])
})
