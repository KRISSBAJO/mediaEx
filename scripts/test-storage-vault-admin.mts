import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import type { StorageKey } from '../backend/media/storage-vault.mts'

// Called by the isolated vault fixture. This exercises the real site-admin session guard.
export async function testStorageAdmin(key: StorageKey, withoutRecord: (run: () => Promise<void>) => Promise<void>) {
  const db = new URL(process.env.DATABASE_URL ?? '')
  assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname) && db.pathname === '/mediaex_vault_fixture')
  const { auth, baseURL, pool } = await import('../backend/auth.mts')
  const { handleAdmin } = await import('../backend/admin.mts')
  const { vaultStatus } = await import('../backend/media/storage-vault.mts')
  const email = randomUUID() + '@example.test'
  const password = randomBytes(24).toString('hex')
  const workspace = process.env.MEDIAEX_VAULT_WORKSPACE!
  const { proxyMedia } = await import('../lib/backend.ts')
  const login = (path: string, data: object) => auth.handler(new Request(baseURL + '/api/auth/' + path, {
    method: 'POST', headers: { origin: baseURL, 'content-type': 'application/json' }, body: JSON.stringify(data),
  }))
  const call = (cookie: string, data: unknown, org = workspace, origin = baseURL) => {
    const route = '/api/admin/workspaces/' + org + '/storage-credential'
    return handleAdmin(new Request(baseURL + route, {
      method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(data),
    }), route.split('/').filter(Boolean))
  }
  let userId = ''
  try {
    const signup = await login('sign-up/email', { email, password, name: 'Pilot operator' })
    assert.ok(signup.ok)
    const signedUp = await signup.json()
    userId = signedUp.user.id
    const readCookie = (r: Response) => r.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
    const input = { action: 'verify', version: 2, key }
    assert.equal((await call('', input)).status, 401)
    assert.equal((await call(readCookie(signup), input)).status, 403)
    await pool.query('update "user" set role=$1, "emailVerified"=true where id=$2', ['admin', userId])
    const session = await login('sign-in/email', { email, password })
    assert.ok(session.ok)
    const cookie = readCookie(session)
    delete process.env.MEDIAEX_PROCESS_ROLE
    assert.equal((await call(cookie, input)).status, 404)
    process.env.MEDIAEX_PROCESS_ROLE = 'storage-operator'
    const path = '/api/admin/workspaces/' + workspace + '/storage-credential'
    const status = (headers: HeadersInit) => handleAdmin(new Request(baseURL + path, { headers }), path.split('/').filter(Boolean))
    assert.equal((await status({})).status, 401)
    const runtimeToken = process.env.MEDIAEX_VAULT_TOKEN_FILE
    delete process.env.MEDIAEX_VAULT_TOKEN_FILE
    const previousFetch = globalThis.fetch
    const transport = randomBytes(24).toString('hex')
    const previousUrl = process.env.MEDIAEX_STORAGE_OPERATOR_URL
    const previousToken = process.env.MEDIAEX_STORAGE_OPERATOR_SERVICE_TOKEN
    process.env.MEDIAEX_STORAGE_OPERATOR_URL = 'https://storage-operator.invalid'
    process.env.MEDIAEX_STORAGE_OPERATOR_SERVICE_TOKEN = transport
    try {
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init)
        if (new URL(request.url).origin !== process.env.MEDIAEX_STORAGE_OPERATOR_URL) return previousFetch(input, init)
        assert.equal(request.url, process.env.MEDIAEX_STORAGE_OPERATOR_URL + path)
        assert.equal(request.headers.get('x-mediaex-service-token'), transport)
        assert.ok(!request.headers.get('cookie')?.includes('unrelated'))
        return handleAdmin(request, path.split('/').filter(Boolean))
      }
      const readThroughFrontend = () => proxyMedia(new Request(baseURL + path, { headers: { cookie: cookie + '; unrelated=fixture' } }))
      await withoutRecord(async () => {
        const first = await readThroughFrontend()
        assert.equal(first.status, 200)
        assert.deepEqual(await first.json(), { state: 'unconfigured' })
      })
      const active = await readThroughFrontend()
      assert.equal(active.status, 200)
      assert.match(active.headers.get('cache-control') ?? '', /no-store/)
      const info = await active.json()
      assert.equal(info.version, 2)
      assert.deepEqual(Object.keys(info).sort(), ['state','actor','checkedAt','earliestRetirement','previousVersion','version'].sort())
      console.log('Passed frontend relay and first-key status with the runtime identity disabled.')
    } finally {
      globalThis.fetch = previousFetch
      if (runtimeToken !== undefined) process.env.MEDIAEX_VAULT_TOKEN_FILE = runtimeToken
      if (previousUrl === undefined) delete process.env.MEDIAEX_STORAGE_OPERATOR_URL
      else process.env.MEDIAEX_STORAGE_OPERATOR_URL = previousUrl
      if (previousToken === undefined) delete process.env.MEDIAEX_STORAGE_OPERATOR_SERVICE_TOKEN
      else process.env.MEDIAEX_STORAGE_OPERATOR_SERVICE_TOKEN = previousToken
    }
    assert.equal((await call(cookie, input, 'different-studio')).status, 404)
    assert.equal((await call(cookie, input, workspace, 'https://other.invalid')).status, 403)
    assert.equal((await call(cookie, { ...input, version: 0 })).status, 409)
    assert.equal((await call(cookie, { ...input, key: {} })).status, 400)
    assert.equal((await call(cookie, { ...input, padding: 'x'.repeat(17000) })).status, 413)
    assert.deepEqual(await (await call(cookie, input)).json(), { action: 'verify', version: 2 })
    const failed = await call(cookie, { action: 'rotate', version: 2, key: { accessKeyId: 'invalid', secretAccessKey: 'sensitive-fixture' } })
    assert.equal(failed.status, 502)
    assert.ok(!(await failed.text()).includes('sensitive-fixture'))
    const switched = await call(cookie, { ...input, action: 'rotate' })
    assert.deepEqual(await switched.json(), { action: 'rotate', version: 3 })
    assert.equal((await call(cookie, { ...input, action: 'rotate' })).status, 409)
    const active = await vaultStatus(workspace, 'owner')
    assert.ok(active?.state === 'active' && active.version === 3 && active.actor === 'Pilot operator')
    const { rows } = await pool.query('select action, details from admin_audit where "adminId"=$1 order by action', [userId])
    assert.deepEqual(rows, [
      { action: 'storage-credential.rotate', details: { previousVersion: 2, version: 3 } },
      { action: 'storage-credential.verify', details: { previousVersion: 2, version: 2 } },
    ])
    console.log('Passed authenticated operator verification, rotation back to the previous credential, access checks and audit attribution.')
  } finally {
    delete process.env.MEDIAEX_PROCESS_ROLE
    if (userId) {
      await pool.query('delete from admin_audit where "adminId"=$1', [userId])
      await pool.query('delete from organization where id in (select "organizationId" from member where "userId"=$1)', [userId])
      await pool.query('delete from "user" where id=$1', [userId])
    }
    await pool.end()
  }
}
