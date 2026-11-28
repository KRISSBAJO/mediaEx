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
  const spec={name:'QA tagger',enabled:false,blocks:[{kind:'match-type',value:'video'},{kind:'add-tag',value:'fixture'},{kind:'notify',value:'Tagged'}]}
  assert.equal((await call('workflows/builder/parameters/queue','PUT',{value:'fixture',previous:null})).status,200)
  spec.blocks[1].value='{{queue}}'
  const saved=await (await call('workflows/builder','POST',spec)).json()
  assert.ok(saved.flow?.id,JSON.stringify(saved))
  const builder='workflows/builder/'+saved.flow.id
  const input={version:1,assetId:first,requestId:randomUUID()}
  const preview=await (await call(builder+'/test','POST',input)).json()
  assert.equal(preview.preview,true)
  assert.deepEqual(preview.notifications,['Tagged'])
  assert.equal((await pool.query('select tags from asset where id=$1',[first])).rows[0].tags.includes('fixture'),false)
  assert.equal((await call(builder+'/run','POST',input)).status,409)
  assert.equal((await call(builder,'PUT',{...spec,version:1,enabled:true})).status,200)
  assert.equal((await call(builder,'PUT',{...spec,version:1})).status,409)
  input.version=2
  for(let i=0;i<2;i++)assert.equal((await call(builder+'/run','POST',input)).status,200)
  assert.equal((await (await call('workflows/builder/activity')).json()).runs.length,1)
  assert.ok((await pool.query('select tags from asset where id=$1',[first])).rows[0].tags.includes('fixture'))
  assert.equal((await call(builder+'/test','POST',{...input,assetId:'outside'})).status,404)
  const {advanceBuilderUploads}=await import('../backend/media/flow-builder.mts')
  assert.equal((await call(builder,'PUT',{...spec,version:2,trigger:'upload',enabled:true})).status,200)
  const auto=await upload()
  assert.equal((await call(builder,'PUT',{...spec,version:3,trigger:'manual',enabled:false})).status,200)
  await Promise.all([advanceBuilderUploads(),advanceBuilderUploads()])
  const history=(await (await call('workflows/builder/activity')).json()).runs
  assert.equal(history.filter(row=>row.asset===auto && row.version===3).length,1)
  assert.equal((await (await call('workflows/builder/usage')).json()).usage.executions,2)
  const oldFetch=globalThis.fetch
  try {
    process.env.DEEPSEEK_API_KEY='fixture'
    globalThis.fetch=async(url,opts)=>{
      assert.equal(url,'https://api.deepseek.com/chat/completions')
      assert.equal(JSON.parse(opts.body).messages[1].content,'Tag videos')
      return Response.json({choices:[{message:{content:JSON.stringify(spec)}}]})
    }
    const agent=await (await call('workflows/builder/agent','POST',{provider:'deepseek',prompt:'Tag videos'})).json()
    assert.equal(agent.draft.enabled,false)
    assert.equal(agent.draft.blocks.length,3)
  } finally {globalThis.fetch=oldFetch;delete process.env.DEEPSEEK_API_KEY}
  console.log('Passed upload-trigger snapshots and provider draft fixture.')
  console.log('Passed manual builder preview, activation, version conflicts, asset writes, replay and activity checks.')
  await pool.query("update api_key set scope='read'")
  assert.equal((await configure(false)).status,403)
  assert.equal((await call('workflows/runs')).status,200)
  console.log('Passed workflow API, upload enrollment, moderation handoff, caption failure/retry, concurrent polling and read scope.')
} finally {
  if(pool) await pool.end()
  await admin.query('drop database '+database)
  await admin.end()
}
