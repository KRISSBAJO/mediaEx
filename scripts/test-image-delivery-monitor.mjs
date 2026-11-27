import assert from 'node:assert/strict'
import test from 'node:test'

for (const [profile, failure] of [['small'], ['phone'], ['phone', 'transfer'], ['phone', 'cleanup']]) {
  test(failure ? `reports a ${failure} failure without claiming success` : `decodes the ${profile} image and cleans up`, async t => {
    const origin = 'https://monitor.example.test'
    const id = 'ast_fixture1'
    const calls = []
    let image
    const trace = '5b545428-697a-460d-9189-07970ae12340'
    const traced = { 'x-mediaex-request-id': trace }
    const output = []
    const originalExit = process.exitCode
    const settings = { MEDIAEX_IMAGE_PROFILE: profile, MEDIAEX_URL: origin, MEDIAEX_MONITOR_KEY: 'fixture', MEDIAEX_MONITOR_WORKSPACE: 'qa' }
    const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]))
    Object.assign(process.env, settings)
    t.after(() => {
      process.exitCode = originalExit
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    })
    for (const level of ['log', 'error']) t.mock.method(console, level, line => output.push(JSON.parse(line)))
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const path = new URL(url).pathname
      const method = init.method ?? 'GET'
      calls.push(method + ' ' + path)
      const headers = new Headers(init.headers)
      if (path === '/thumb') {
        assert.equal(headers.has('authorization'), false)
        return new Response(image)
      }
      assert.equal(headers.get('authorization'), 'Bearer fixture')
      if (method === 'PUT') {
        image = init.body
        if (profile === 'small') assert.ok(image.length > 0 && image.length < 64 * 1024)
        else assert.ok(image.length > 1024 * 1024)
        return new Response(null, { status: failure === 'transfer' ? 502 : 200, headers: traced })
      }
      if (path.endsWith('/whoami')) return Response.json({ workspace: { id: 'qa' }, key: { scope: 'full' } })
      if (path.endsWith('/uploads')) return Response.json({ asset: { id }, upload: { kind: 'single', url: '/api/v1/uploads/' + id } }, { headers: traced })
      if (path.endsWith('/complete')) return Response.json({}, { headers: { 'x-mediaex-request-id': 'invalid' } })
      if (method === 'DELETE' && failure === 'cleanup') return new Response(null, { status: 503 })
      return Response.json({ asset: { status: 'ready', thumbUrl: '/thumb' } })
    })
    await import(`./check-image-delivery.mjs?profile=${profile}&failure=${failure}`)
    assert.equal(process.exitCode, failure ? 1 : originalExit)
    assert.equal(output.length, 1)
    assert.deepEqual(output[0].requestIds, { create: trace, transfer: trace })
    assert.equal(output[0].result, failure ? undefined : 'passed')
    assert.equal(output[0].profile, profile)
    assert.equal(output[0].stage, failure ?? 'cleanup')
    assert.equal(calls.includes('GET /thumb'), failure !== 'transfer')
    assert.equal(calls.at(-1), 'DELETE /api/v1/assets/' + id)
  })
}
