import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { backendFetch, proxyAuth } from '../lib/backend.ts'

test('the frontend forwards auth to its configured API and returns independent cookies and redirects', async (t) => {
  const requests = []
  const api = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ method: req.method, url: req.url, headers: req.headers, body })
    res.writeHead(302, {
      location: 'https://frontend.example/dashboard',
      'set-cookie': [
        '__Secure-better-auth.session_token=fixture; Path=/; Secure; HttpOnly',
        'better-auth.state=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
      ],
    }).end()
  })
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => api.close(resolve)))
  const previousUrl = process.env.BACKEND_URL
  const previousToken = process.env.MEDIAEX_API_TOKEN
  t.after(() => {
    if (previousUrl === undefined) delete process.env.BACKEND_URL
    else process.env.BACKEND_URL = previousUrl
    if (previousToken === undefined) delete process.env.MEDIAEX_API_TOKEN
    else process.env.MEDIAEX_API_TOKEN = previousToken
  })
  process.env.BACKEND_URL = `http://127.0.0.1:${api.address().port}`
  process.env.MEDIAEX_API_TOKEN = 'fixture-only-transport-token-for-the-test'
  const body = JSON.stringify({ callbackURL: '/dashboard' })
  const request = new Request('https://frontend.example/api/auth/sign-in/social?remember=true', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://frontend.example',
      'sec-fetch-site': 'same-origin',
      cookie: '__Secure-better-auth.session_token=fixture; unrelated=private',
      forwarded: 'host=ignored.invalid',
      'x-forwarded-host': 'ignored.invalid',
      'x-mediaex-service-token': 'untrusted',
      'x-mediaex-auth-cookie': 'untrusted=private',
    },
    body,
  })
  const response = await proxyAuth(request)
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'https://frontend.example/dashboard')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.getSetCookie().length, 2)
  assert.equal(requests.length, 1)
  const received = requests[0]
  assert.equal(received.method, 'POST')
  assert.equal(received.url, '/api/auth/sign-in/social?remember=true')
  assert.equal(received.body, body)
  assert.equal(received.headers.origin, 'https://frontend.example')
  assert.equal(received.headers.cookie, '__Secure-better-auth.session_token=fixture')
  assert.equal(received.headers['sec-fetch-site'], 'same-origin')
  assert.equal(received.headers['x-mediaex-service-token'], process.env.MEDIAEX_API_TOKEN)
  assert.equal(received.headers['x-mediaex-auth-cookie'], undefined)
  assert.equal(received.headers.forwarded, undefined)
  assert.equal(received.headers['x-forwarded-host'], undefined)
  assert.equal((await proxyAuth(new Request('https://frontend.example/api/mediaex/account'))).status, 404)
  await assert.rejects(backendFetch('https://other.example/api/auth/get-session'), /Invalid MediaEX API destination/)
  assert.equal(requests.length, 1)

  const origin = process.env.BACKEND_URL
  const prefix = '/_service-relay/mediaex'
  for (const suffix of [prefix, prefix + '/']) {
    process.env.BACKEND_URL = origin + suffix
    const bridged = await proxyAuth(new Request('https://frontend.example/api/auth/get-session?next=%2Fdashboard', {
      headers: {
        cookie: 'hoist_session=private; __Secure-better-auth.session_token=fixture',
        'x-mediaex-auth-cookie': 'hoist_session=forged',
        'x-forwarded-host': 'ignored.invalid',
      },
    }))
    assert.equal(bridged.status, 302)
    assert.equal(bridged.headers.getSetCookie().length, 2)
    const hit = requests.at(-1)
    assert.equal(hit.url, prefix + '/api/auth/get-session?next=%2Fdashboard')
    assert.equal(hit.headers.host, new URL(origin).host)
    assert.equal(hit.headers.cookie, undefined)
    assert.equal(hit.headers['x-mediaex-auth-cookie'], '__Secure-better-auth.session_token=fixture')
    assert.equal(hit.headers['x-mediaex-service-token'], process.env.MEDIAEX_API_TOKEN)
    assert.equal(hit.headers['x-forwarded-host'], undefined)
  }
  await backendFetch('/api/mediaex/account', { headers: { cookie: 'hoist_session=private', 'x-mediaex-auth-cookie': 'forged' } })
  assert.equal(requests.at(-1).headers.cookie, undefined)
  assert.equal(requests.at(-1).headers['x-mediaex-auth-cookie'], undefined)
  const beforeInvalid = requests.length
  for (const target of [
    '//other.invalid/api/auth', '/api/auth/../../other', '/api/%2e%2e/other', '/api/auth%2Fcallback',
    '/api/auth%252fcallback', '/api/auth%5ccallback', '/api/auth%3fback', '/api/auth%23back',
    '/api/auth/\\other', '/api/auth/#fragment',
  ]) {
    await assert.rejects(backendFetch(target), /Invalid MediaEX API destination/)
  }
  for (const location of [
    origin + prefix + '?config=bad', origin + prefix + '#fragment', origin + '/a/../b', origin + '/a/%2E%2E/b',
    origin + '/something%2fother', origin + '/a//b', origin.replace('://', '://user:secret@'),
  ]) {
    process.env.BACKEND_URL = location
    await assert.rejects(backendFetch('/api/auth/get-session'), /Invalid MediaEX API destination/)
  }
  assert.equal(requests.length, beforeInvalid)
})
