import assert from 'node:assert/strict'
import { test } from 'node:test'
import { proxyMedia } from '../lib/backend.ts'

test('upload response traces survive backend rejection and gateway failures', async t => {
  const logs = []
  t.mock.method(console, 'info', line => logs.push(JSON.parse(line)))
  process.env.BACKEND_URL = 'http://127.0.0.1:3401'
  const mock = t.mock.method(globalThis, 'fetch', (_, init) => new Response(null, {
    status: 409, headers: { 'x-mediaex-request-id': init.headers.get('x-mediaex-request-id') },
  }))
  const request = () => new Request('https://example.test/api/v1/uploads/asset-secret/complete?private=query', {
    method: 'POST', headers: { authorization: 'Bearer confidential', 'x-mediaex-request-id': 'untrusted' },
  })
  for (const [source, status] of [['backend', 409], ['upstream', 413], ['proxy', 503]]) {
    if (source === 'upstream') mock.mock.mockImplementation(() => new Response(null, { status }))
    if (source === 'proxy') mock.mock.mockImplementation(() => { throw new Error('connection failed') })
    const response = await proxyMedia(request())
    const id = response.headers.get('x-mediaex-request-id')
    assert.match(id, /^[0-9a-f-]{36}$/)
    assert.equal(response.status, status)
    assert.deepEqual([logs.at(-1).traceId, logs.at(-1).source, logs.at(-1).stage], [id, source, 'complete'])
  }
  assert.doesNotMatch(JSON.stringify(logs), /private|asset-secret|confidential|untrusted/)
})
