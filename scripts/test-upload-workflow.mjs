import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import pg from 'pg'

const url=new URL(process.env.DATABASE_URL)
assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'Use a local PostgreSQL server.')
const admin=new pg.Client({connectionString:url.href})
const database='mx_flow_'+randomUUID().replaceAll('-','')
await admin.connect()
await admin.query('create database '+database)
let pool
try {
  url.pathname='/'+database
  process.env.DATABASE_URL=url.href
  process.env.MEDIA_WORKER='off'
  delete process.env.S3_BUCKET
  delete process.env.OPENAI_API_KEY
  execFileSync(process.execPath,['--experimental-strip-types','backend/migrate.mts'],{stdio:'inherit'})
  ;({pool}=await import('../backend/auth.mts'))
  const {handleV1}=await import('../backend/media/v1.mts')
  const {advanceWorkflows}=await import('../backend/media/workflows.mts')
  const key='mx_live_'+randomUUID().replaceAll('-','')
  await pool.query(`insert into organization(id,name,slug,"createdAt") values('org','demo','demo',now())`)
  await pool.query(`insert into api_key(id,"organizationId",name,scope,hash,last4) values('test','org','fixture','full',$1,'test')`,[createHash('sha256').update(key).digest('hex')])
  const call=(path,method='GET',body)=>handleV1(new Request('http://localhost/api/v1/'+path,{method,headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)}),['api','v1',...path.split('/')])
  const configure=captions=>call('workflows/omoshow-upload-review','PUT',{enabled:true,captions})
  assert.equal((await configure(true)).status,409)
  assert.equal((await configure(false)).status,200)
  async function upload(){
    const response=await call('uploads','POST',{fileName:'fixture.mp4',size:100,mimeType:'video/mp4'})
    const body=await response.json()
    assert.equal(response.status,201,JSON.stringify(body))
    const id=body.asset.id
    await pool.query(`update asset set status='ready' where id=$1 and "uploadPolicy"->>'review'='true'`,[id])
    return id
  }
  const run=async id=>(await (await call('workflows/runs/'+id)).json()).runs[0]
  const first=await upload()
  await advanceWorkflows()
  assert.equal((await run(first)).phase,'complete')
  assert.equal((await pool.query('select moderation from asset where id=$1',[first])).rows[0].moderation,'pending')
  process.env.OPENAI_API_KEY='fixture-never-sent'
  assert.equal((await configure(true)).status,200)
  const second=await upload()
  delete process.env.OPENAI_API_KEY
  await advanceWorkflows()
  assert.match((await run(second)).error,/OPENAI_API_KEY/)
  assert.equal((await call('workflows/runs/'+second+'/retry','POST')).status,409)
  process.env.OPENAI_API_KEY='fixture-never-sent'
  assert.equal((await call('workflows/runs/'+second+'/retry','POST')).status,200)
  await Promise.all([advanceWorkflows(),advanceWorkflows()])
  assert.equal((await pool.query('select count(*)::int as n from caption where "assetId"=$1',[second])).rows[0].n,1)
  await pool.query(`update caption set status='ready' where "assetId"=$1`,[second])
  await advanceWorkflows()
  assert.equal((await run(second)).phase,'complete')
  await pool.query("update api_key set scope='read'")
  assert.equal((await configure(false)).status,403)
  assert.equal((await call('workflows/runs')).status,200)
  console.log('Passed workflow API, upload enrollment, moderation handoff, caption failure/retry, concurrent polling and read scope.')
} finally {
  if(pool) await pool.end()
  await admin.query('drop database '+database)
  await admin.end()
}
