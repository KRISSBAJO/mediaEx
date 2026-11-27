import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { open, readFile, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const key = 'recovery/video.mp4'

export async function seed(api, bucket, file, size, save) {
  await api('PUT',bucket)
  const uploads = bucket+'/uploads'
  const state = await (await api('POST',uploads,{key,size})).json()
  await save(state)
  assert.ok(size > state.partSize,'Choose a video larger than one part.')
  const bytes = await readPart(file,0,state.partSize)
  await api('PUT',uploads,{uploadId:state.uploadId,part:1,sha256:sha(bytes)},bytes)
  return state
}

async function readPart(file,position,length) {
  const bytes = Buffer.alloc(length)
  let read = 0
  while (read<length) {
    const result = await file.read(bytes,read,length-read,position+read)
    if (!result.bytesRead) throw Error('Video changed during the drill.')
    read += result.bytesRead
  }
  return bytes
}

export async function recover(api,bucket,file,state) {
  const upload = {uploadId:state.uploadId}
  const uploads = bucket+'/uploads'
  const status = await (await api('GET',uploads,upload)).json()
  assert.equal(status.key,key)
  assert.equal(status.size,(await file.stat()).size)
  assert.equal(status.partSize,state.partSize)
  assert.ok(status.parts.some(p=>p.number===1),'First acknowledged part was lost.')
  const existing = new Map(status.parts.map(p=>[p.number,p.sha256]))
  const input = createHash('sha256')
  let transmitted = 0
  for (let offset=0,number=1;offset<status.size;offset+=status.partSize,number++) {
    const bytes = await readPart(file,offset,Math.min(status.partSize,status.size-offset))
    input.update(bytes)
    if (existing.has(number)) { assert.equal(existing.get(number),sha(bytes)); continue }
    await api('PUT',uploads,{...upload,part:number,sha256:sha(bytes)},bytes)
    transmitted += bytes.length
  }
  const result = await (await api('POST',uploads,upload)).json()
  assert.deepEqual(await (await api('POST',uploads,upload)).json(),result)
  const object = bucket+'/objects'
  const response = await api('GET',object,{key})
  assert.equal(Number(response.headers.get('content-length')),status.size)
  const output = createHash('sha256')
  for await (const chunk of response.body) output.update(chunk)
  const digest = input.digest('hex')
  assert.equal(output.digest('hex'),digest)
  const length = Math.min(8,status.size-status.partSize+4)
  const start = status.partSize-4
  const range = await api('GET',object,{key},undefined,{range:'bytes='+start+'-'+(start+length-1)})
  assert.equal(range.status,206)
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),await readPart(file,start,length))
  return {bytes:status.size,transmitted,sha256:digest}
}

async function main() {
  const [mode,video,checkpoint] = process.argv.slice(2)
  assert.ok(['seed','recover'].includes(mode) && video && checkpoint,'Usage: seed|recover VIDEO CHECKPOINT')
  const origin = new URL(process.env.MEDIAEX_URL).origin
  assert.ok(origin.startsWith('https://'))
  const workspace = process.env.MEDIAEX_MONITOR_WORKSPACE
  const token = process.env.MEDIAEX_MONITOR_KEY
  assert.ok(workspace && token)
  async function request(path,method,params={},body,headers={}) {
    const url = new URL('/api/v1/'+path,origin)
    url.search = new URLSearchParams(params).toString()
    for (let attempt=0;;attempt++) {
      const response = await fetch(url,{method,body,headers:{...headers,authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(120000)})
      if (response.ok) return response
      await response.body?.cancel()
      if (response.status!==429 || attempt===4) throw Error(method+' '+path+' returned '+response.status)
      const seconds = Number(response.headers.get('retry-after') ?? 60)
      await delay(1000*Math.min(120,Math.max(1,Number.isFinite(seconds) ? seconds : 60)))
    }
  }
  const identity = await (await request('whoami','GET')).json()
  assert.equal(identity.workspace.id,workspace)
  assert.equal(identity.key.scope,'full')
  const api = (method,path,params,body,headers) => request('buckets/'+path,method,params,body,headers)
  const file = await open(video,'r')
  try {
    if (mode==='seed') {
      const size = (await file.stat()).size
      assert.ok(size>8*1024*1024)
      const bucket = 'recovery-'+randomUUID()
      const info = {origin,workspace,bucket}
      await writeFile(checkpoint,JSON.stringify(info),{flag:'wx',mode:0o600})
      await seed(api,bucket,file,size,state=>writeFile(checkpoint,JSON.stringify({...info,state})))
      console.log('First part acknowledged. Checkpoint saved for the backend restart.')
    } else {
      const {origin:saved,workspace:owner,bucket,state} = JSON.parse(await readFile(checkpoint,'utf8'))
      assert.equal(saved,origin)
      assert.equal(owner,workspace)
      assert.match(bucket,/^recovery-[0-9a-f-]{36}$/)
      const result = await recover(api,bucket,file,state)
      await api('DELETE',bucket+'/objects',{key})
      await api('DELETE',bucket)
      await unlink(checkpoint)
      console.log(JSON.stringify(result))
    }
  } finally { await file.close() }
}

if (import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await main()
