import assert from 'node:assert/strict'
import { fork, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp,rm,cp,open,readFile,appendFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { nativeBuckets, bucketUsage } from '../backend/media/native-buckets.mts'
import { seed,recover } from './check-native-multipart.mjs'
import test from 'node:test'

const bucket = 'video-recovery'
const workspace = 'pilot'
const partBytes = 1024*1024
function api(method,route,params={},body,headers={}) {
  return nativeBuckets(new Request('http://fixture/?'+new URLSearchParams(params),{method,body,headers,duplex:'half'}),
    workspace,route.split('/'),run=>run(async()=>{}))
}

if (process.argv[2]==='interrupt') {
  const file = await open(process.argv[3],'r')
  const state = await seed(api,bucket,file,(await file.stat()).size,async()=>{})
  const partial = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.alloc(32*1024))
    },
    pull() { process.send(state); return new Promise(()=>{}) },
  })
  setInterval(()=>{},10000)
  await api('PUT',bucket+'/uploads',{uploadId:state.uploadId,part:2},partial)
} else test('kill the upload process mid-part and resume a playable video from the same volume and a cold copy', async t=>{
  const root = await mkdtemp(path.join(os.tmpdir(),'mediaex-video-drill-'))
  const previous = process.env.MEDIA_DIR
  t.after(async()=>{
    if (previous===undefined) delete process.env.MEDIA_DIR
    else process.env.MEDIA_DIR=previous
    await rm(root,{recursive:true,force:true})
  })
  const video = path.join(root,'video.mp4')
  execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','testsrc2=size=160x90:rate=12','-t','1','-c:v','libx264','-pix_fmt','yuv420p',video])
  const padding = Buffer.alloc(16*partBytes)
  padding.writeUInt32BE(padding.length)
  padding.write('free',4)
  await appendFile(video,padding)
  const volume = path.join(root,'volume')
  const child = fork(fileURLToPath(import.meta.url),['interrupt',video],{env:{...process.env,MEDIA_DIR:volume},stdio:['ignore','ignore','inherit','ipc']})
  const exited = once(child,'exit')
  t.after(()=>{ if (child.exitCode===null && !child.killed) child.kill('SIGKILL') })
  const state = await Promise.race([once(child,'message').then(([message])=>message),exited.then(()=>{throw Error('Child stopped before the interruption')})])
  child.kill('SIGKILL')
  await exited
  const copy = path.join(root,'restored')
  await cp(volume,copy,{recursive:true})
  const file = await open(video,'r')
  t.after(()=>file.close())
  for (const location of [volume,copy]) {
    process.env.MEDIA_DIR=location
    const upload = bucket+'/uploads'
    const objects = bucket+'/objects'
    const ref = {uploadId:state.uploadId}
    const status = await (await api('GET',upload,ref)).json()
    assert.deepEqual(status.parts.map(p=>p.number),[1])
    assert.equal(bucketUsage(workspace),partBytes)
    await assert.rejects(api('POST',upload,ref),{status:409})
    await assert.rejects(api('GET',objects,{key:status.key}),{status:404})
    await assert.rejects(api('DELETE',bucket),{status:409})
    await assert.rejects(api('PUT',upload,{...ref,part:1},Buffer.alloc(partBytes)),{status:409})
    const result = await recover(api,bucket,file,state)
    assert.equal(result.transmitted,result.bytes-partBytes)
    assert.equal(bucketUsage(workspace),result.bytes)
    const pendingRead = await api('GET',objects,{key:status.key})
    await api('PUT',objects,{key:status.key},'replacement')
    assert.deepEqual(Buffer.from(await pendingRead.arrayBuffer()),await readFile(video))
    assert.equal(bucketUsage(workspace),11)
    await api('DELETE',objects,{key:status.key})
    const pending = await (await api('POST',upload,{key:'aborted',size:3})).json()
    await api('PUT',upload,{uploadId:pending.uploadId,part:1},'abc')
    assert.equal(bucketUsage(workspace),3)
    await api('DELETE',upload,{uploadId:pending.uploadId})
    assert.equal(bucketUsage(workspace),0)
    await api('DELETE',bucket)
    console.log('Recovered',result.bytes,'bytes; SHA-256',result.sha256)
  }
})

if (process.argv[2]!=='interrupt') test('upgrade an existing bucket and enforce checksums, quota, create-only completion and expiry', async t=>{
  const { DatabaseSync } = await import('node:sqlite')
  const { createHash } = await import('node:crypto')
  const { mkdir } = await import('node:fs/promises')
  const root = await mkdtemp(path.join(os.tmpdir(),'mediaex-old-volume-'))
  const previous = process.env.MEDIA_DIR
  process.env.MEDIA_DIR=root
  t.after(async()=>{
    if (previous===undefined) delete process.env.MEDIA_DIR
    else process.env.MEDIA_DIR=previous
    await rm(root,{recursive:true,force:true})
  })
  const dir = path.join(root,'.native-buckets')
  await mkdir(dir)
  const catalog = path.join(dir,createHash('sha256').update(workspace).digest('hex')+'.sqlite')
  const old = new DatabaseSync(catalog)
  old.exec('create table bucket(name text primary key); create table object(bucket text not null references bucket(name),key text not null,bytes blob not null,etag text not null,primary key(bucket,key)) without rowid;')
  old.prepare('insert into bucket values (?)').run(bucket)
  old.prepare('insert into object values (?,?,?,?)').run(bucket,'old',Buffer.from('old'),'v1')
  old.close()
  const objects = bucket+'/objects'
  const uploads = bucket+'/uploads'
  assert.equal(await (await api('GET',objects,{key:'old'})).text(),'old')
  const state = await (await api('POST',uploads,{key:'old',size:4,partSize:8388608},undefined,{'if-none-match':'*'})).json()
  assert.equal(state.partSize,8388608)
  const ref = {uploadId:state.uploadId}
  const part = {...ref,part:1}
  await assert.rejects(api('PUT',uploads,{...part,sha256:'bad'},'test'),{status:400})
  const req = new Request('http://fixture/?'+new URLSearchParams(part),{method:'PUT',body:'test'})
  await assert.rejects(nativeBuckets(req,workspace,uploads.split('/'),run=>run(async bytes=>{
    assert.equal(bytes,4)
    throw Error('quota exhausted')
  })),/quota exhausted/)
  assert.equal(bucketUsage(workspace),3)
  await api('PUT',uploads,part,'test')
  await api('PUT',uploads,part,'test')
  assert.equal(bucketUsage(workspace),7)
  await assert.rejects(api('POST',uploads,ref),{status:412})
  assert.equal(await (await api('GET',objects,{key:'old'})).text(),'old')
  const db = new DatabaseSync(catalog)
  db.prepare('update upload set expires=0 where id=?').run(ref.uploadId)
  db.close()
  await assert.rejects(api('GET',uploads,ref),{status:404})
  await api('PUT',bucket)
  assert.equal(bucketUsage(workspace),3)
})
