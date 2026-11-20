import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { auth, pool } from '../backend/auth.mts'
import { handleAdmin } from '../backend/admin.mts'
import { getAssetRow, newAssetId } from '../backend/media/assets.mts'
import { cleanPermanentDeletions, recovery } from '../backend/media/recovery.mts'
import { storage } from '../backend/media/storage.mts'

test('admin deletion is permission checked and preserves file references through cascades and failed cleanup', { skip: !process.env.DATABASE_URL }, async t => {
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname))
  const dir = await mkdtemp(path.join(os.tmpdir(),'mediaex-admin-recovery-'))
  process.env.MEDIA_DIR = dir
  process.env.MEDIA_WORKER = 'off'
  const prefix = 'erasure-test-' + randomUUID()
  const [org,sole,shared] = ['admin','sole','shared'].map(x=>prefix+'-'+x)
  const admin = prefix+'-admin-user', user = prefix+'-test-user'
  const session = { user:{id:admin,name:'Fixture',email:admin+'@example.test',role:'user',emailVerified:true},session:{} }
  t.mock.method(auth.api,'getSession', async () => session)
  const call = async (url,method,body) => handleAdmin(new Request('http://localhost'+url,{method,body:body && JSON.stringify(body),headers:{'content-type':'application/json'}}),url.split('/').filter(Boolean))
  const id = newAssetId(), b = newAssetId(), failed = newAssetId(), soleAsset = newAssetId()
  const title = 'File fixture'
  const manager = { orgId:org, role:'owner', via:'session',scope:'full',userId:admin }
  async function asset(workspace,id,status='ready') {
    const key = workspace+'/'+id+'/original.png'
    await mkdir(path.join(dir,workspace,id),{recursive:true})
    await writeFile(path.join(dir,key),id)
    await pool.query(`insert into asset (id,"organizationId",title,type,status,"fileName","originalKey",size,"storageBackend",playback)
      values ($1,$2,$3,'image',$4,'original.png',$5,$6,'local','signed')`,[id,workspace,title,status,key,id.length])
    return key
  }
  const job = async id => (await pool.query('select * from media_permanent_cleanup where "assetId"=$1',[id])).rows[0]
  try {
    for (const uid of [admin,user]) await pool.query('insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt") values ($1,$1,$2,true,now(),now())',[uid,uid+'@example.test'])
    for (const workspace of [org,sole,shared]) await pool.query('insert into organization (id,name,slug,"createdAt") values ($1,$1,$1,now())',[workspace])
    for (const [workspace,uid] of [[sole,user],[shared,user],[shared,admin],[org,admin]])
      await pool.query('insert into member (id,"organizationId","userId",role,"createdAt") values ($1,$2,$3,\'owner\',now())',[randomUUID(),workspace,uid])
    const originalKey = await asset(org,id)
    const replacementKey = await asset(org,b)
    const api = '/api/admin/assets/'+id
    assert.equal((await call(api,'DELETE')).status,403)
    session.user.role = 'admin'
    const rev = (await getAssetRow(id,org)).revisionId
    const publish = () => recovery(manager,new Request('http://localhost',{method:'POST',body:JSON.stringify({expectedCurrent:rev,replacementId:b})}),id,'revisions')
    assert.equal((await call('/api/admin/assets/'+b+'/takedown','POST',{reason:'fixture'})).status,200)
    await assert.rejects(publish(),e=>e.status===409)
    assert.equal((await call('/api/admin/assets/'+b+'/restore','POST')).status,200)
    assert.equal((await publish()).status,200)
    await pool.query('update asset set "deletedAt"=now() where id=$1',[id])
    assert.equal((await call(api+'/takedown','POST',{reason:'fixture'})).status,200)
    assert.equal((await call(api+'/restore','POST')).status,200)
    assert.equal(await getAssetRow(id,org),null)
    assert.equal((await call(api+'/retry','POST')).status,404)
    assert.equal((await call(api,'DELETE')).status,204)
    assert.equal((await job(id)).versions.length,2)
    assert.equal((await pool.query('select 1 from admin_audit where action=\'asset.delete\' and "targetId"=$1',[id])).rowCount,1)
    const local = storage({storageBackend:'local'})
    const originalRemove = local.removePrefix.bind(local)
    let count = 0
    const fault = t.mock.method(local,'removePrefix',async p => {
      if (++count===2) throw Error('fixture interruption')
      await originalRemove(p)
    })
    await cleanPermanentDeletions(org)
    assert.equal((await job(id)).attempts,1)
    assert.equal((await job(id)).versions.length,2)
    fault.mock.restore()
    await pool.query('update media_permanent_cleanup set "nextAttemptAt"=now() where "assetId"=$1',[id])
    await cleanPermanentDeletions(org)
    assert.equal(await job(id),undefined)
    for (const key of [originalKey,replacementKey]) await assert.rejects(readFile(path.join(dir,key)),{code:'ENOENT'})
    const processingKey = await asset(org,failed,'processing')
    const orgPath = '/api/admin/workspaces/'+org
    assert.equal((await call(orgPath,'DELETE')).status,409)
    assert.equal((await getAssetRow(failed,org)).status,'processing')
    await pool.query('update asset set status=\'ready\' where id=$1',[failed])
    assert.equal((await call(orgPath,'DELETE')).status,204)
    assert.equal((await job(failed)).versions[0].originalKey,processingKey)
    await cleanPermanentDeletions(org)
    assert.equal(await job(failed),undefined)
    await asset(sole,soleAsset)
    // Better Auth's user removal ultimately issues this DELETE after checking the admin.
    await pool.query('delete from "user" where id=$1',[user])
    assert.equal((await pool.query('select 1 from organization where id=$1',[shared])).rowCount,1)
    assert.equal((await pool.query('select 1 from organization where id=$1',[sole])).rowCount,0)
    assert.equal((await job(soleAsset)).organizationId,sole)
    await cleanPermanentDeletions(sole)
    assert.equal(await job(soleAsset),undefined)
  } finally {
    await pool.query('update asset set status=\'ready\' where "organizationId"=any($1::text[])',[[org,sole,shared]])
    await pool.query('delete from organization where id=any($1::text[])',[[org,sole,shared]])
    await pool.query('delete from "user" where id=any($1::text[])',[[admin,user]])
    await pool.query('delete from media_permanent_cleanup where "organizationId"=any($1::text[])',[[org,sole,shared]])
    await pool.query('delete from admin_audit where "adminEmail"=$1',[admin+'@example.test'])
    await pool.end()
    await rm(dir,{recursive:true,force:true})
  }
})
