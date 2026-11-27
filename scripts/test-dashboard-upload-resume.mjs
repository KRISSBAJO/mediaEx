import assert from 'node:assert/strict'
import test from 'node:test'
import { lookupResume, waitForUploadRetry } from '../lib/media/upload-resume.ts'

const id = 'ast_example'
const plan = { partSize: 4, partCount: 3, uploaded: [{number: 3, size: 2}] }

test('resumes with the server-confirmed final part', async () => {
  const result = await lookupResume(id, 10, async () => Response.json(plan))
  assert.equal(result.kind, 'active')
  assert.deepEqual([...result.have], [3])
})

test('only missing or expired sessions allow a fresh upload', async () => {
  for (const status of [404, 410]) {
    assert.equal(await lookupResume(id, 10, async () => new Response(null, { status })), null)
  }
  for (const status of [401, 403, 429, 502, 503]) {
    await assert.rejects(lookupResume(id, 10, async () => new Response(null, { status })), new RegExp(String(status)))
  }
  await assert.rejects(lookupResume(id, 10, async () => { throw new TypeError('Offline') }), /Offline/)
})

test('recovers an already completed asset after a lost response', async () => {
  const asset = { id, size: 10, status: 'queued' }
  const result = await lookupResume(id, 10, async path => {
    if (path === '/api/uploads/' + id + '/parts') return new Response(null, {status: 409})
    assert.equal(path, '/api/assets/' + id)
    return Response.json({ asset })
  })
  assert.deepEqual(result, { kind: 'completed', asset })
})

test('rejects inconsistent geometry and partial stored bytes', async () => {
  for (const invalid of [{...plan, partCount: 2}, {...plan, uploaded: [{number: 3, size: 1}]}]) {
    await assert.rejects(lookupResume(id, 10, async () => Response.json(invalid)), /does not match/)
  }
})

test('cancellation releases offline and backing-off retries without a reconnect', async () => {
  for (const online of [false, true]) {
    const controller = new AbortController()
    const network = new EventTarget()
    const waiting = waitForUploadRetry(controller.signal, 60000, network, () => online)
    controller.abort(new Error('CANCELLED'))
    await assert.rejects(waiting, /CANCELLED/)
    network.dispatchEvent(new Event('online'))
  }
})

test('reconnecting permits an interrupted transfer to retry', async () => {
  const network = new EventTarget()
  const waiting = waitForUploadRetry(new AbortController().signal, 0, network, () => false)
  network.dispatchEvent(new Event('online'))
  await waiting
})
