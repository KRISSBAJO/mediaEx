import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, randomBytes } from 'node:crypto'
import { createEmailVerificationToken } from 'better-auth/api'

// Run against a migrated disposable local PostgreSQL database. The fixtures do not send email.
test('site admin access requires a verified address on both public API surfaces', async t => {
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname))
  const prefix = 'admin-test-' + randomUUID().slice(0,12)
  const bootstrap = prefix + '-bootstrap@example.test'
  const ordinary = prefix + '-member@example.test'
  const pending = prefix + '-pending@example.test'
  process.env.SITE_ADMIN_EMAILS = bootstrap
  process.env.BETTER_AUTH_URL = 'http://localhost:3400'
  process.env.BETTER_AUTH_SECRET = randomBytes(40).toString('hex')
  process.env.NODE_ENV = 'production'
  delete process.env.RESEND_API_KEY
  // sendEmail intentionally logs unavailable delivery in a production-mode fixture.
  t.mock.method(console, 'warn', () => {})
  const {auth, pool, baseURL, bootstrapVerifiedAdmins} = await import('../backend/auth.mts')
  const {getAccount} = await import('../backend/account.mts')
  const {handleAdmin} = await import('../backend/admin.mts')
  const addresses = [bootstrap, ordinary, pending]
  t.after(async () => {
    const ids = (await pool.query('select id from "user" where email=any($1::text[])',[addresses])).rows.map(r=>r.id)
    await pool.query('delete from admin_audit where "adminId"=any($1::text[]) or "targetId"=any($1::text[])',[ids])
    await pool.query('delete from organization where id in (select "organizationId" from member where "userId"=any($1::text[]))',[ids])
    await pool.query('delete from "user" where id=any($1::text[])',[ids])
    await pool.end()
  })
  const password = randomBytes(20).toString('hex')
  const callAuth = (path, cookie='', data) => auth.handler(new Request(baseURL+'/api/auth/'+path, {
    method: data ? 'POST' : 'GET', headers: { cookie, origin:baseURL, 'Content-Type':'application/json' },
    ...(data && {body:JSON.stringify(data)}),
  }))
  const app = (route, cookie, data) => handleAdmin(new Request(baseURL+route, {
    method:data ? 'POST':'GET', headers:{cookie}, ...(data && {body:JSON.stringify(data)}),
  }),route.split('/').filter(Boolean))
  const signup = async email => {
    const res = await callAuth('sign-up/email', '', {email,password,name:'QA member'})
    assert.equal(res.status,200,'sign up')
    const cookie = res.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
    const { user } = await res.json()
    assert.ok(cookie && user.id)
    return {cookie,id:user.id}
  }
  const candidate = await signup(bootstrap)
  const teammate = await signup(ordinary)
  const target = await signup(pending)
  const roleOf = async id => (await pool.query('select role,"emailVerified" from "user" where id=$1',[id])).rows[0]
  assert.deepEqual(await roleOf(candidate.id), {role:'user',emailVerified:false})
  await bootstrapVerifiedAdmins()
  assert.equal((await roleOf(candidate.id)).role,'user')
  const account = await getAccount(new Headers({cookie:candidate.cookie}))
  assert.equal(account.user.isAdmin,false)
  assert.ok(account.workspace.id,'ordinary workspace login still works')

  // A stored legacy role is inert until verification, even with a pre-existing login.
  await pool.query('update "user" set role=\'admin\' where id=$1',[target.id])
  assert.equal((await app('/api/admin/me', target.cookie)).status,403)
  assert.equal((await callAuth('admin/list-users', target.cookie)).status,403)
  assert.equal((await getAccount(new Headers({cookie:target.cookie}))).user.isAdmin,false)
  assert.equal((await callAuth('admin/list-users')).status,401)
  assert.equal((await app('/api/admin/me', candidate.cookie)).status,403)
  const verify = async email => {
    const token = await createEmailVerificationToken(process.env.BETTER_AUTH_SECRET,email)
    const res = await callAuth('verify-email?token='+encodeURIComponent(token))
    assert.equal(res.status,200,'email challenge completion')
  }
  await verify(bootstrap)
  assert.deepEqual(await roleOf(candidate.id),{role:'admin',emailVerified:true})
  const login = await callAuth('sign-in/email', '', {email:bootstrap,password})
  assert.equal(login.status,200)
  const adminCookie = login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  assert.equal((await app('/api/admin/me',adminCookie)).status,200)
  assert.equal((await callAuth('admin/list-users',adminCookie)).status,200)
  assert.equal((await app('/api/admin/admins',adminCookie,{email:ordinary})).status,409)
  assert.equal((await callAuth('admin/set-role',adminCookie,{userId:teammate.id,role:'admin'})).status,403)
  assert.equal((await callAuth('admin/update-user',adminCookie,{userId:teammate.id,data:{emailVerified:true}})).status,403)
  assert.equal((await callAuth('admin/create-user',adminCookie,{email:prefix+'-unused@example.test',name:'unused',password,role:'admin'})).status,403)
  assert.deepEqual(await roleOf(teammate.id),{role:'user',emailVerified:false})
  await verify(ordinary)
  assert.deepEqual(await roleOf(teammate.id),{role:'user',emailVerified:true})
  assert.equal((await app('/api/admin/admins',adminCookie,{email:ordinary})).status,200)
  assert.deepEqual(await roleOf(teammate.id),{role:'admin',emailVerified:true})
  assert.equal(await bootstrapVerifiedAdmins(),0,'migration is idempotent')
})
