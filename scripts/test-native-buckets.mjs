import assert from 'node:assert/strict'
import test from 'node:test'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { nativeBuckets, bucketUsage } from '../backend/media/native-buckets.mts'

test('private native buckets on a fresh volume', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mediaex-native-'))
  const previous = process.env.MEDIA_DIR
  process.env.MEDIA_DIR = root
  t.after(async () => {
    if (previous === undefined) delete process.env.MEDIA_DIR
    else process.env.MEDIA_DIR = previous
    await rm(root, {recursive:true, force:true})
  })
  let quotaCheck = async () => {}
  const bucket = ['venue-media']
  const objects = [...bucket,'objects']
  function call(method, parts, query = {}, body, headers = {}, org = 'one') {
    const req = new Request('http://fixture/api/v1/buckets?' + new URLSearchParams(query), {method, body, headers})
    return nativeBuckets(req, org, parts, run => run(quotaCheck))
  }
  assert.deepEqual(await (await call('GET', [])).json(), {buckets:[]})
  assert.equal((await call('PUT',bucket)).status,204)
  const key = 'venues/日本/cover'
  const first = await call('PUT',objects,{key},'hello')
  assert.ok(first.headers.get('etag'))
  assert.equal(bucketUsage('one'),5)
  const restored = await mkdtemp(path.join(tmpdir(), 'mediaex-restored-'))
  t.after(() => rm(restored, {recursive:true, force:true}))
  await cp(root, restored, {recursive:true})
  process.env.MEDIA_DIR = restored
  assert.equal(await (await call('GET',objects,{key})).text(),'hello')
  await call('PUT',objects,{key},'restored copy')
  process.env.MEDIA_DIR = root
  assert.equal(await (await call('GET',objects,{key})).text(),'hello')
  assert.equal(await (await call('GET',objects,{key},undefined,{range:'bytes=1-3'})).text(),'ell')
  assert.equal((await call('HEAD',objects,{key})).headers.get('content-length'),'5')
  assert.equal((await call('GET',objects,{key},undefined,{range:'bytes=5-'})).status,416)
  assert.equal((await call('GET',objects,{key},undefined,{'if-none-match':first.headers.get('etag')})).status,304)
  await assert.rejects(call('PUT',objects,{key},Buffer.alloc(8*1024*1024+1)), {status:413})
  await assert.rejects(call('PUT',objects,{key},'again',{'if-none-match':'*'}),{status:412})
  await assert.rejects(call('GET',objects,{key},undefined,{},'other'),{status:404})
  await assert.rejects(call('DELETE',bucket),{status:409})
  quotaCheck = async delta => { assert.equal(delta,1); throw Error('quota') }
  await assert.rejects(call('PUT',objects,{key},'longer'),/quota/)
  assert.equal(await (await call('GET',objects,{key})).text(),'hello')
  quotaCheck = async () => {}
  await call('PUT',objects,{key:'venues/empty'},'')
  assert.equal((await call('GET',objects,{key:'venues/empty'})).headers.get('content-length'),'0')
  const page = await (await call('GET',objects,{prefix:'venues/',limit:1})).json()
  assert.equal(page.objects.length,1)
  const next = await (await call('GET',objects,{prefix:'venues/',after:page.nextAfter})).json()
  assert.equal(next.objects[0].key,key)
  await call('DELETE',objects,{key})
  await call('DELETE',objects,{key:'venues/empty'})
  assert.equal((await call('DELETE',bucket)).status,204)
  assert.equal(bucketUsage('one'),0)
})
