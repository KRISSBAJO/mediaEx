import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { auth, baseURL, pool } from '../backend/auth.mts'
import { deliverResetMail } from '../backend/password-reset-mail.mts'

const db = new URL(process.env.DATABASE_URL ?? '')
assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname) && db.pathname === '/mediaex_vault_fixture')
assert.equal(baseURL, 'https://mediaex.example.test')
assert.equal(process.env.NODE_ENV, 'production')
assert.ok(!process.env.RESEND_API_KEY && !process.env.MAIL_FROM)
const email = randomUUID() + '@example.test'
const unknown = randomUUID() + '@example.test'
const request = (route: string, body: object) => auth.handler(new Request(baseURL + '/api/auth/' + route, {
  method:'POST', headers:{origin:baseURL,'content-type':'application/json'}, body:JSON.stringify(body),
}))
const reset = (email: string) => request('request-password-reset', {email,redirectTo:'/reset-password'})
const nativeFetch = globalThis.fetch
try {
  assert.ok((await request('sign-up/email', {email,password:randomUUID(),name:'Reset fixture'})).ok)
  for (const address of [email, unknown]) assert.equal((await reset(address)).status, 503)
  // Keep the actual production reset rate limit for the second pair of requests.
  await delay(61_000)
  process.env.RESEND_API_KEY = 'fixture-only'
  process.env.MAIL_FROM = 'MediaEX <test@example.test>'
  const known = await reset(email)
  const absent = await reset(unknown)
  assert.equal(known.status,200)
  assert.equal(absent.status,200)
  assert.deepEqual(await known.json(), await absent.json())
  const row = await pool.query('select "verificationId" from password_reset_mail')
  assert.equal(row.rows.length, 1)
  let accepted = false
  let attempts = 0
  let outbound: any
  let idempotency: string | null = null
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init)
    assert.equal(req.url,'https://api.resend.com/emails')
    const key = req.headers.get('idempotency-key')
    assert.ok(key)
    if (idempotency) assert.equal(key,idempotency)
    idempotency = key
    outbound = await req.json()
    attempts++
    return new Response('{}', { status: accepted ? 200 : 503 })
  }
  assert.equal(await deliverResetMail(),1)
  assert.equal(await deliverResetMail(),0)
  await pool.query('update password_reset_mail set "nextAttemptAt"=now()')
  accepted = true
  assert.equal(await deliverResetMail(),1)
  assert.equal(await deliverResetMail(),0)
  assert.equal(attempts,2)
  assert.equal(outbound.to,email)
  const link = new URL(outbound.text.match(/https:\/\/[^\s]+/)[0])
  assert.equal(link.origin,baseURL)
  const callback = await auth.handler(new Request(link))
  assert.ok(callback.status >= 300 && callback.status < 400)
  const landing = new URL(callback.headers.get('location')!,baseURL)
  assert.equal(landing.pathname,'/reset-password')
  assert.ok(landing.searchParams.get('token'))
  assert.ok((await request('reset-password',{newPassword:randomUUID(),token:landing.searchParams.get('token')})).ok)
  console.log('Passed missing configuration for known and unknown accounts, uniform acceptance, provider retry, idempotency, delivered recipient and single-use reset.')
} finally {
  globalThis.fetch = nativeFetch
  await pool.end()
}
