import assert from 'node:assert/strict'
import test from 'node:test'

for (const [profile, failedTransfer] of [['small', false], ['phone', false], ['phone', true]]) {
  test(failedTransfer ? 'reports a large transfer failure and cleans up' : `decodes the ${profile} image and cleans up`, async t => {
    const origin = 'https://monitor.example.test'
    const id = 'ast_fixture1'
    const calls = []
    let image
    let output
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
    t.mock.method(console, failedTransfer ? 'error' : 'log', line => { output = JSON.parse(line) })
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
        return new Response(null, { status: failedTransfer ? 502 : 200 })
      }
      if (path.endsWith('/whoami')) return Response.json({ workspace: { id: 'qa' }, key: { scope: 'full' } })
      if (path.endsWith('/uploads')) return Response.json({ asset: { id }, upload: { kind: 'single', url: '/api/v1/uploads/' + id } })
      return Response.json({ asset: { status: 'ready', thumbUrl: '/thumb' } })
    })
    await import(`./check-image-delivery.mjs?profile=${profile}&failure=${failedTransfer}`)
    assert.equal(process.exitCode, failedTransfer ? 1 : originalExit)
    assert.equal(output.profile, profile)
    assert.equal(output.stage, failedTransfer ? 'transfer' : 'thumbnail')
    assert.equal(calls.includes('GET /thumb'), !failedTransfer)
    assert.equal(calls.at(-1), 'DELETE /api/v1/assets/' + id)
  })
}
