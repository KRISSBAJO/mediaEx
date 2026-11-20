/**
 * Site admin: the people who run MediaEX itself, across every workspace.
 *
 * Who: users whose role is "admin" (Better Auth's admin plugin). SITE_ADMIN_EMAILS makes the first ones on every
 * start; admins add and remove others here. Every action is written to the audit log (admin_audit), as are
 * impersonations (see the session hooks in auth.mts).
 *
 *   GET    /api/admin/me                                   who's asking
 *   GET    /api/admin/overview                             platform numbers, sign-ups, alerts
 *   GET    /api/admin/users?q=&status=&limit=&offset=      users;  /:id for one, with workspaces, sessions, audit
 *   POST   /api/admin/users/:id/{ban,unban,revoke-sessions,verify-email,reset-password,role}
 *   DELETE /api/admin/users/:id                            the user, and workspaces only they belong to
 *   GET    /api/admin/workspaces?q=&status=                workspaces;  /:id for one, with members, usage, billing
 *   POST   /api/admin/workspaces/:id/{suspend,unsuspend,plan,note}
 *   DELETE /api/admin/workspaces/:id                       the workspace, its media and its files
 *   GET    /api/admin/assets?q=&status=&moderation=&taken=&workspace=
 *   POST   /api/admin/assets/:id/{takedown,restore,retry}  ·  DELETE /api/admin/assets/:id
 *   GET    /api/admin/billing                              revenue, subscriptions, past due, overrides
 *   GET    /api/admin/ops                                  pipeline, captions, webhooks, system health
 *   POST   /api/admin/ops/retry-failed                     re-queue recent failed jobs
 *   GET    /api/admin/audit?q=&action=&limit=&offset=
 *   GET    /api/admin/admins  ·  POST /api/admin/admins { email }  ·  DELETE /api/admin/admins/:userId
 *
 * Impersonation itself goes through Better Auth (/api/auth/admin/impersonate-user), which sets the cookies.
 */
import { statfs } from 'node:fs/promises'
import path from 'node:path'
import { audit, auth, baseURL, pool, siteAdminEmails } from './auth.mts'
import { HttpError, handle, getAssetRow, prefixOf } from './media/assets.mts'
import { storage } from './media/storage.mts'
import { kickWorker } from './media/worker.mts'
import { encoders, encoderFor } from './media/encoding.mts'
import { captionsAvailable } from './media/captions.mts'
import { aiAvailable } from './media/moderation.mts'
import { PLANS, provider as billingProvider } from './media/billing.mts'
import type { PlanId } from './media/types.mts'

type Admin = { id: string; email: string; name: string }
const noStore = { 'Cache-Control': 'no-store' }
const PAID: PlanId[] = ['pro', 'studio']

/** The signed-in site admin, or 401/403. An impersonation session is never an admin session. */
export async function requireAdmin(headers: Headers): Promise<Admin> {
  const s = await auth.api.getSession({ headers })
  if (!s) throw new HttpError(401, 'Sign in to continue.')
  const role = (s.user as { role?: string | null }).role ?? ''
  if ((s.session as { impersonatedBy?: string | null }).impersonatedBy || !role.split(',').includes('admin')) throw new HttpError(403, 'Site admins only.')
  return { id: s.user.id, email: s.user.email, name: s.user.name }
}

async function body<T>(req: Request) {
  return ((await req.json().catch(() => null)) ?? {}) as T
}
const page = (sp: URLSearchParams, max = 100) => ({
  limit: Math.min(max, Math.max(1, Number(sp.get('limit')) || 50)),
  offset: Math.max(0, Number(sp.get('offset')) || 0),
})
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
const MONTH_PRICE = (plan: PlanId, interval: string | null) => (interval === 'year' ? PLANS[plan].year / 12 : PLANS[plan].month)

/* ------------------------------------------------ overview */
async function overview() {
  const [{ rows: [k] }, { rows: signups }, { rows: recent }, { rows: topStorage }, { rows: mrrRows }] = await Promise.all([
    pool.query(`select
      (select count(*)::int from "user") as users,
      (select count(*)::int from "user" where "createdAt" > now() - interval '7 days') as "newUsers7d",
      (select count(*)::int from "user" where banned) as banned,
      (select count(*)::int from "organization") as workspaces,
      (select count(*)::int from "workspace_admin" where "suspendedAt" is not null) as suspended,
      (select count(*)::int from "asset") as assets,
      (select coalesce(sum(size + "outputSize"), 0)::text from "asset") as "storageBytes",
      (select coalesce(sum(duration), 0)::float / 60 from "asset" where "readyAt" > date_trunc('month', now()) and type <> 'image') as "minutesThisMonth",
      (select count(*)::int from "view_session" where "startedAt" > now() - interval '30 days' and "watchSeconds" >= 2) as "views30d",
      (select count(*)::int from "asset" where status = 'failed' and "updatedAt" > now() - interval '24 hours') as "failed24h",
      (select count(*)::int from "asset" where status in ('queued', 'processing')) as "inPipeline",
      (select count(*)::int from "subscription" where status = 'past_due') as "pastDue",
      (select count(*)::int from "webhook_endpoint" where enabled and failures >= 3) as "failingWebhooks",
      (select count(*)::int from "asset" where "takenDown" is not null) as "takenDown",
      (select count(*)::int from "asset" where moderation = 'pending') as "inReview"`),
    pool.query(`select to_char(d, 'YYYY-MM-DD') as day, (select count(*)::int from "user" u where u."createdAt" >= d and u."createdAt" < d + interval '1 day') as users
       from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d order by d`),
    pool.query(`select id, name, email, "createdAt", "emailVerified" from "user" order by "createdAt" desc limit 8`),
    pool.query(`select o.id, o.name, coalesce(sum(a.size + a."outputSize"), 0)::text as bytes, count(a.id)::int as assets
       from "organization" o left join "asset" a on a."organizationId" = o.id group by o.id order by sum(a.size + a."outputSize") desc nulls last limit 6`),
    pool.query(`select plan, interval from "subscription" where status in ('active', 'past_due') and "currentPeriodEnd" > now() and plan in ('pro', 'studio')`),
  ])
  const mrr = mrrRows.reduce((t, r) => t + MONTH_PRICE(r.plan, r.interval), 0)
  return {
    kpis: { ...k, storageBytes: Number(k.storageBytes), mrr, paidWorkspaces: mrrRows.length },
    signups,
    recentUsers: recent,
    topStorage: topStorage.map((r) => ({ ...r, bytes: Number(r.bytes) })),
  }
}

/* ------------------------------------------------ users */
async function listUsers(sp: URLSearchParams) {
  const { limit, offset } = page(sp)
  const where: string[] = []
  const args: unknown[] = []
  const arg = (v: unknown) => (args.push(v), `$${args.length}`)
  const q = sp.get('q')?.trim()
  if (q) where.push(`(u.email ilike ${arg(like(q))} or u.name ilike ${arg(like(q))} or u.id = ${arg(q)})`)
  const status = sp.get('status')
  if (status === 'banned') where.push('u.banned')
  if (status === 'admins') where.push(`u.role = 'admin'`)
  if (status === 'unverified') where.push('not u."emailVerified"')
  if (status === 'active') where.push('not coalesce(u.banned, false)')
  const w = where.length ? `where ${where.join(' and ')}` : ''
  const { rows } = await pool.query(
    `select u.id, u.name, u.email, u."emailVerified", u.role, u.banned, u."banReason", u."banExpires", u."createdAt",
            (select max(s."updatedAt") from "session" s where s."userId" = u.id) as "lastSeenAt",
            (select count(*)::int from "member" m where m."userId" = u.id) as workspaces
       from "user" u ${w} order by u."createdAt" desc limit ${limit} offset ${offset}`,
    args,
  )
  const { rows: [t] } = await pool.query(`select count(*)::int as total from "user" u ${w}`, args)
  return { users: rows, total: t.total, limit, offset }
}

async function oneUser(id: string) {
  const { rows: [user] } = await pool.query(
    `select id, name, email, "emailVerified", image, role, banned, "banReason", "banExpires", "createdAt", "updatedAt" from "user" where id = $1`,
    [id],
  )
  if (!user) throw new HttpError(404, 'That user doesn’t exist.')
  const [{ rows: workspaces }, { rows: sessions }, { rows: accounts }, { rows: log }] = await Promise.all([
    pool.query(
      `select o.id, o.name, o.slug, m.role, (select count(*)::int from "member" x where x."organizationId" = o.id) as members,
              (select count(*)::int from "asset" a where a."organizationId" = o.id) as assets,
              (select w."suspendedAt" from "workspace_admin" w where w."organizationId" = o.id) as "suspendedAt"
         from "member" m join "organization" o on o.id = m."organizationId" where m."userId" = $1 order by m."createdAt"`,
      [id],
    ),
    pool.query(`select id, "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent", "impersonatedBy" from "session" where "userId" = $1 and "expiresAt" > now() order by "updatedAt" desc limit 20`, [id]),
    pool.query(`select "providerId" from "account" where "userId" = $1`, [id]),
    pool.query(`select * from "admin_audit" where "targetType" = 'user' and "targetId" = $1 order by "createdAt" desc limit 30`, [id]),
  ])
  return { user: { ...user, signIn: accounts.map((a) => a.providerId), bootstrapAdmin: siteAdminEmails().includes(user.email.toLowerCase()) }, workspaces, sessions, audit: log }
}

/** Workspaces this user is the only member of: deleting the user deletes these too. */
async function soleWorkspaces(userId: string) {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `select o.id, o.name from "organization" o join "member" m on m."organizationId" = o.id and m."userId" = $1
      where (select count(*) from "member" x where x."organizationId" = o.id) = 1`,
    [userId],
  )
  return rows
}

async function userAction(a: Admin, req: Request, id: string, action: string) {
  const { rows: [u] } = await pool.query<{ id: string; email: string; role: string | null }>('select id, email, role from "user" where id = $1', [id])
  if (!u) throw new HttpError(404, 'That user doesn’t exist.')
  const self = u.id === a.id
  const isAdmin = (u.role ?? '').split(',').includes('admin')
  const headers = req.headers
  switch (action) {
    case 'ban': {
      if (self) throw new HttpError(400, 'You can’t suspend yourself.')
      if (isAdmin) throw new HttpError(400, 'Remove their admin role before suspending an admin.')
      const b = await body<{ reason?: unknown; days?: unknown }>(req)
      const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 300) : 'Suspended by MediaEX'
      const days = typeof b.days === 'number' && b.days > 0 && b.days <= 3650 ? Math.floor(b.days) : undefined
      await auth.api.banUser({ headers, body: { userId: id, banReason: reason, ...(days ? { banExpiresIn: days * 86400 } : {}) } })
      await audit({ adminId: a.id, action: 'user.suspend', targetType: 'user', targetId: id, details: { email: u.email, reason, days: days ?? null } })
      break
    }
    case 'unban':
      await auth.api.unbanUser({ headers, body: { userId: id } })
      await audit({ adminId: a.id, action: 'user.restore', targetType: 'user', targetId: id, details: { email: u.email } })
      break
    case 'revoke-sessions':
      await auth.api.revokeUserSessions({ headers, body: { userId: id } })
      await audit({ adminId: a.id, action: 'user.sign-out-everywhere', targetType: 'user', targetId: id, details: { email: u.email } })
      break
    case 'verify-email':
      await pool.query(`update "user" set "emailVerified" = true, "updatedAt" = now() where id = $1`, [id])
      await audit({ adminId: a.id, action: 'user.verify-email', targetType: 'user', targetId: id, details: { email: u.email } })
      break
    case 'reset-password':
      await auth.api.requestPasswordReset({ body: { email: u.email, redirectTo: `${baseURL}/reset-password` } })
      await audit({ adminId: a.id, action: 'user.send-password-reset', targetType: 'user', targetId: id, details: { email: u.email } })
      break
    case 'role': {
      const b = await body<{ role?: unknown }>(req)
      if (b.role !== 'admin' && b.role !== 'user') throw new HttpError(400, 'role must be "admin" or "user".')
      await setRole(a, u, b.role, headers)
      break
    }
    default:
      throw new HttpError(404, 'Not found')
  }
  return Response.json(await oneUser(id), { headers: noStore })
}

async function setRole(a: Admin, u: { id: string; email: string }, role: 'admin' | 'user', headers: Headers) {
  if (role === 'user') {
    if (u.id === a.id) throw new HttpError(400, 'You can’t remove your own admin role. Ask another admin.')
    if (siteAdminEmails().includes(u.email.toLowerCase())) throw new HttpError(400, `${u.email} is in SITE_ADMIN_EMAILS, so they’re an admin again on the next start. Remove them from that setting first.`)
  }
  await auth.api.setRole({ headers, body: { userId: u.id, role } })
  await audit({ adminId: a.id, action: role === 'admin' ? 'admin.add' : 'admin.remove', targetType: 'user', targetId: u.id, details: { email: u.email } })
}

/** Deletes a workspace: its rows (cascading to assets, keys, webhooks…) and every file it stored. */
async function deleteWorkspace(orgId: string) {
  const { rows: assets } = await pool.query<{ id: string; organizationId: string; upload: { uploadId: string } | null; originalKey: string }>(
    'select id, "organizationId", upload, "originalKey" from "asset" where "organizationId" = $1',
    [orgId],
  )
  await pool.query('delete from "organization" where id = $1', [orgId])
  // files go after the rows, so nothing can reference a half-deleted asset; failures are logged, not fatal
  for (const x of assets) {
    if (x.upload) await storage().multipartAbort(x.originalKey, x.upload.uploadId).catch(() => {})
    await storage().removePrefix(prefixOf(x)).catch((e) => console.error(`[admin] couldn’t remove files of ${x.id}:`, e instanceof Error ? e.message : e))
  }
  return assets.length
}

async function deleteUser(a: Admin, req: Request, id: string) {
  if (id === a.id) throw new HttpError(400, 'You can’t delete your own account here.')
  const { rows: [u] } = await pool.query<{ email: string; role: string | null }>('select email, role from "user" where id = $1', [id])
  if (!u) throw new HttpError(404, 'That user doesn’t exist.')
  if ((u.role ?? '').split(',').includes('admin')) throw new HttpError(400, 'Remove their admin role before deleting an admin.')
  const sole = await soleWorkspaces(id)
  let assets = 0
  for (const w of sole) assets += await deleteWorkspace(w.id)
  await auth.api.removeUser({ headers: req.headers, body: { userId: id } })
  await audit({ adminId: a.id, action: 'user.delete', targetType: 'user', targetId: id, details: { email: u.email, workspacesDeleted: sole.map((w) => w.name), assetsDeleted: assets } })
  return new Response(null, { status: 204 })
}

/* ------------------------------------------------ workspaces */
async function listWorkspaces(sp: URLSearchParams) {
  const { limit, offset } = page(sp)
  const where: string[] = []
  const args: unknown[] = []
  const arg = (v: unknown) => (args.push(v), `$${args.length}`)
  const q = sp.get('q')?.trim()
  if (q) where.push(`(o.name ilike ${arg(like(q))} or o.slug ilike ${arg(like(q))} or o.id = ${arg(q)} or exists (select 1 from "member" m join "user" u on u.id = m."userId" where m."organizationId" = o.id and u.email ilike ${arg(like(q))}))`)
  const status = sp.get('status')
  if (status === 'suspended') where.push('w."suspendedAt" is not null')
  if (status === 'paid') where.push(`s.plan in ('pro', 'studio') and s.status in ('active', 'past_due') and s."currentPeriodEnd" > now()`)
  if (status === 'override') where.push('w."planOverride" is not null')
  const w = where.length ? `where ${where.join(' and ')}` : ''
  const from = `from "organization" o left join "workspace_admin" w on w."organizationId" = o.id left join "subscription" s on s."organizationId" = o.id ${w}`
  const { rows } = await pool.query(
    `select o.id, o.name, o.slug, o."createdAt", w."suspendedAt", w."suspendReason", w."planOverride", w."overrideUntil",
            s.plan as "subPlan", s.status as "subStatus", s."currentPeriodEnd", s.interval,
            (select count(*)::int from "member" m where m."organizationId" = o.id) as members,
            (select count(*)::int from "asset" a where a."organizationId" = o.id) as assets,
            (select coalesce(sum(a.size + a."outputSize"), 0)::text from "asset" a where a."organizationId" = o.id) as bytes,
            (select u.email from "member" m join "user" u on u.id = m."userId" where m."organizationId" = o.id and m.role like 'owner%' order by m."createdAt" limit 1) as owner
       ${from} order by o."createdAt" desc limit ${limit} offset ${offset}`,
    args,
  )
  const { rows: [t] } = await pool.query(`select count(*)::int as total ${from}`, args)
  return { workspaces: rows.map((r) => ({ ...r, bytes: Number(r.bytes), plan: effectivePlan(r) })), total: t.total, limit, offset }
}

/** The plan a workspace has now, from an admin override, then its subscription. */
function effectivePlan(r: { planOverride?: string | null; overrideUntil?: Date | null; subPlan?: string | null; subStatus?: string | null; currentPeriodEnd?: Date | null }): PlanId {
  if (r.planOverride && (!r.overrideUntil || new Date(r.overrideUntil) > new Date())) return r.planOverride as PlanId
  if (r.subPlan && PAID.includes(r.subPlan as PlanId) && r.subStatus !== 'incomplete' && r.currentPeriodEnd && new Date(r.currentPeriodEnd).getTime() + (r.subStatus === 'past_due' ? 7 * 86400_000 : 0) > Date.now()) {
    return r.subPlan as PlanId
  }
  return 'creator'
}

async function oneWorkspace(id: string) {
  const { rows: [o] } = await pool.query(
    `select o.id, o.name, o.slug, o."createdAt", w."suspendedAt", w."suspendReason", w."planOverride", w."overrideUntil", w.note,
            s.plan as "subPlan", s.status as "subStatus", s.interval, s.provider, s."customerId", s."subscriptionId", s."currentPeriodEnd", s."cancelAtPeriodEnd"
       from "organization" o left join "workspace_admin" w on w."organizationId" = o.id left join "subscription" s on s."organizationId" = o.id where o.id = $1`,
    [id],
  )
  if (!o) throw new HttpError(404, 'That workspace doesn’t exist.')
  const [{ rows: members }, { rows: [usage] }, { rows: assets }, { rows: [dev] }, { rows: settings }, { rows: log }] = await Promise.all([
    pool.query(`select u.id, u.name, u.email, u.banned, m.role, m."createdAt" from "member" m join "user" u on u.id = m."userId" where m."organizationId" = $1 order by m."createdAt"`, [id]),
    pool.query(
      `select count(*)::int as assets, coalesce(sum(size + "outputSize"), 0)::text as bytes,
              count(*) filter (where status = 'failed')::int as failed, count(*) filter (where "takenDown" is not null)::int as "takenDown",
              coalesce(sum(duration) filter (where "readyAt" > date_trunc('month', now()) and type <> 'image'), 0)::float / 60 as "minutesThisMonth",
              (select count(*)::int from "view_session" v where v."organizationId" = $1 and v."startedAt" > now() - interval '30 days' and v."watchSeconds" >= 2) as "views30d"
         from "asset" where "organizationId" = $1`,
      [id],
    ),
    pool.query(`select id, title, type, status, moderation, "takenDown", size, "createdAt" from "asset" where "organizationId" = $1 order by "createdAt" desc limit 12`, [id]),
    pool.query(
      `select (select count(*)::int from "api_key" k where k."organizationId" = $1 and k."revokedAt" is null) as keys,
              (select count(*)::int from "webhook_endpoint" e where e."organizationId" = $1) as webhooks`,
      [id],
    ),
    pool.query(`select "moderationMode", "aiReview", "extraCodecs", "autoCaptions" from "workspace_setting" where "organizationId" = $1`, [id]),
    pool.query(`select * from "admin_audit" where "targetType" = 'workspace' and "targetId" = $1 order by "createdAt" desc limit 30`, [id]),
  ])
  return { workspace: { ...o, plan: effectivePlan(o) }, members, usage: { ...usage, bytes: Number(usage.bytes) }, assets, developer: dev, settings: settings[0] ?? null, audit: log }
}

async function workspaceAction(a: Admin, req: Request, id: string, action: string) {
  const { rows: [o] } = await pool.query<{ name: string }>('select name from "organization" where id = $1', [id])
  if (!o) throw new HttpError(404, 'That workspace doesn’t exist.')
  const upsert = (set: string, args: unknown[]) =>
    pool.query(`insert into "workspace_admin" ("organizationId") values ($1) on conflict do nothing; `, [id]).then(() =>
      pool.query(`update "workspace_admin" set ${set}, "updatedAt" = now() where "organizationId" = $1`, [id, ...args]),
    )
  if (action === 'suspend') {
    const b = await body<{ reason?: unknown }>(req)
    const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 300) : 'Suspended by MediaEX'
    await upsert(`"suspendedAt" = now(), "suspendReason" = $2`, [reason])
    await audit({ adminId: a.id, action: 'workspace.suspend', targetType: 'workspace', targetId: id, details: { name: o.name, reason } })
  } else if (action === 'unsuspend') {
    await upsert(`"suspendedAt" = null, "suspendReason" = null`, [])
    await audit({ adminId: a.id, action: 'workspace.restore', targetType: 'workspace', targetId: id, details: { name: o.name } })
  } else if (action === 'plan') {
    const b = await body<{ plan?: unknown; until?: unknown }>(req)
    if (b.plan !== null && !['creator', 'pro', 'studio'].includes(b.plan as string)) throw new HttpError(400, 'plan must be creator, pro, studio, or null to remove the override.')
    const until = typeof b.until === 'string' && !Number.isNaN(Date.parse(b.until)) ? new Date(b.until) : null
    if (until && until < new Date()) throw new HttpError(400, 'The override has to end in the future.')
    await upsert(`"planOverride" = $2, "overrideUntil" = $3`, [b.plan, b.plan ? until : null])
    await audit({ adminId: a.id, action: b.plan ? 'workspace.plan-override' : 'workspace.plan-override-remove', targetType: 'workspace', targetId: id, details: { name: o.name, plan: b.plan, until } })
  } else if (action === 'note') {
    const b = await body<{ note?: unknown }>(req)
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 2000) || null : null
    await upsert(`note = $2`, [note])
    await audit({ adminId: a.id, action: 'workspace.note', targetType: 'workspace', targetId: id, details: { name: o.name } })
  } else throw new HttpError(404, 'Not found')
  return Response.json(await oneWorkspace(id), { headers: noStore })
}

/* ------------------------------------------------ media */
async function listAssets(sp: URLSearchParams) {
  const { limit, offset } = page(sp)
  const where: string[] = []
  const args: unknown[] = []
  const arg = (v: unknown) => (args.push(v), `$${args.length}`)
  const q = sp.get('q')?.trim()
  if (q) where.push(`(a.title ilike ${arg(like(q))} or a."fileName" ilike ${arg(like(q))} or a.id = ${arg(q)})`)
  const status = sp.get('status')
  if (status && ['uploading', 'queued', 'processing', 'ready', 'failed'].includes(status)) where.push(`a.status = ${arg(status)}`)
  const mod = sp.get('moderation')
  if (mod && ['approved', 'pending', 'rejected'].includes(mod)) where.push(`a.moderation = ${arg(mod)}`)
  if (sp.get('taken') === '1') where.push('a."takenDown" is not null')
  const ws = sp.get('workspace')
  if (ws) where.push(`a."organizationId" = ${arg(ws)}`)
  const w = where.length ? `where ${where.join(' and ')}` : ''
  const { rows } = await pool.query(
    `select a.id, a.title, a.type, a.status, a.error, a.moderation, a."moderationFlags", a."takenDown", a."takenDownAt", a.size, a."outputSize", a.duration,
            a."createdAt", a."thumbKey" is not null as "hasThumb", a.playback, o.id as "workspaceId", o.name as "workspaceName",
            (select count(*)::int from "view_session" v where v."assetId" = a.id and v."watchSeconds" >= 2) as views
       from "asset" a join "organization" o on o.id = a."organizationId" ${w} order by a."createdAt" desc limit ${limit} offset ${offset}`,
    args,
  )
  const { rows: [t] } = await pool.query(`select count(*)::int as total from "asset" a ${w}`, args)
  return { assets: rows.map((r) => ({ ...r, size: Number(r.size), outputSize: Number(r.outputSize), thumbUrl: r.hasThumb ? `/api/admin/assets/${r.id}/thumb` : null })), total: t.total, limit, offset }
}

async function assetAction(a: Admin, req: Request, id: string, action: string) {
  const row = await getAssetRow(id)
  if (!row) throw new HttpError(404, 'That asset doesn’t exist.')
  if (action === 'takedown') {
    const b = await body<{ reason?: unknown }>(req)
    const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 300) : 'Removed by MediaEX'
    await pool.query(`update "asset" set "takenDown" = $2, "takenDownAt" = now(), "updatedAt" = now() where id = $1`, [id, reason])
    await audit({ adminId: a.id, action: 'asset.takedown', targetType: 'asset', targetId: id, details: { title: row.title, workspace: row.organizationId, reason } })
  } else if (action === 'restore') {
    await pool.query(`update "asset" set "takenDown" = null, "takenDownAt" = null, "updatedAt" = now() where id = $1`, [id])
    await audit({ adminId: a.id, action: 'asset.restore', targetType: 'asset', targetId: id, details: { title: row.title, workspace: row.organizationId } })
  } else if (action === 'retry') {
    if (row.status !== 'failed' && row.status !== 'ready') throw new HttpError(409, 'Only failed or ready assets can be processed again.')
    await pool.query(`update "asset" set status = 'queued', stage = 1, progress = 0, error = null, attempts = 0, "updatedAt" = now() where id = $1`, [id])
    kickWorker()
    await audit({ adminId: a.id, action: 'asset.retry', targetType: 'asset', targetId: id, details: { title: row.title, workspace: row.organizationId } })
  } else throw new HttpError(404, 'Not found')
  return Response.json({ ok: true }, { headers: noStore })
}

async function deleteAsset(a: Admin, id: string) {
  const row = await getAssetRow(id)
  if (!row) throw new HttpError(404, 'That asset doesn’t exist.')
  await pool.query('delete from "asset" where id = $1', [id])
  if (row.upload) await storage().multipartAbort(row.originalKey, row.upload.uploadId).catch(() => {})
  await storage().removePrefix(prefixOf(row)).catch(() => {})
  await audit({ adminId: a.id, action: 'asset.delete', targetType: 'asset', targetId: id, details: { title: row.title, workspace: row.organizationId } })
  return new Response(null, { status: 204 })
}

/** The thumbnail, for admins (works whatever the asset's moderation, takedown or signed-playback state). */
async function assetThumb(id: string, req: Request) {
  const row = await getAssetRow(id)
  if (!row?.thumbKey) return new Response('Not found', { status: 404 })
  return storage().serve(row.thumbKey, req)
}

/* ------------------------------------------------ billing */
async function billing() {
  const { rows: subs } = await pool.query(
    `select s.*, o.name as "workspaceName", w."planOverride", w."overrideUntil"
       from "subscription" s join "organization" o on o.id = s."organizationId" left join "workspace_admin" w on w."organizationId" = s."organizationId"
      order by s."updatedAt" desc limit 200`,
  )
  const live = subs.filter((s) => PAID.includes(s.plan) && ['active', 'past_due'].includes(s.status) && s.currentPeriodEnd && new Date(s.currentPeriodEnd) > new Date())
  const mrr = live.reduce((t, s) => t + MONTH_PRICE(s.plan, s.interval), 0)
  const byPlan = PAID.map((p) => ({ plan: p, count: live.filter((s) => s.plan === p).length, mrr: live.filter((s) => s.plan === p).reduce((t, s) => t + MONTH_PRICE(s.plan, s.interval), 0) }))
  const { rows: overrides } = await pool.query(
    `select w."organizationId" as id, o.name, w."planOverride", w."overrideUntil" from "workspace_admin" w join "organization" o on o.id = w."organizationId"
      where w."planOverride" is not null and (w."overrideUntil" is null or w."overrideUntil" > now()) order by o.name`,
  )
  const { rows: events } = await pool.query(`select provider, "eventId", type, "receivedAt" from "billing_event" order by "receivedAt" desc limit 25`)
  const { rows: [counts] } = await pool.query(`select (select count(*)::int from "organization") as workspaces`)
  const link = (s: { provider: string; customerId: string | null }) =>
    !s.customerId ? null : s.provider === 'stripe' ? `https://dashboard.stripe.com/customers/${s.customerId}` : s.provider === 'paystack' ? `https://dashboard.paystack.com/#/customers/${s.customerId}` : null
  return {
    provider: billingProvider(),
    mrr,
    arr: mrr * 12,
    paidWorkspaces: live.length,
    workspaces: counts.workspaces,
    byPlan,
    yearlyShare: live.length ? live.filter((s) => s.interval === 'year').length / live.length : 0,
    pastDue: subs.filter((s) => s.status === 'past_due').map((s) => ({ ...s, providerUrl: link(s) })),
    cancelling: live.filter((s) => s.cancelAtPeriodEnd).map((s) => ({ ...s, providerUrl: link(s) })),
    subscriptions: subs.map((s) => ({ ...s, providerUrl: link(s) })),
    overrides,
    events,
  }
}

/* ------------------------------------------------ operations */
const started = Date.now()
async function ops() {
  const t0 = performance.now()
  const db = await pool.query('select 1').then(() => ({ ok: true, ms: Math.round(performance.now() - t0) }), (e) => ({ ok: false, ms: 0, error: e instanceof Error ? e.message : String(e) }))
  const [{ rows: [pipe] }, { rows: failed }, { rows: [cc] }, { rows: ccFailed }, { rows: hooks }, { rows: [hk] }] = await Promise.all([
    pool.query(`select count(*) filter (where status = 'uploading')::int as uploading, count(*) filter (where status = 'queued')::int as queued,
                       count(*) filter (where status = 'processing')::int as processing,
                       count(*) filter (where status = 'failed' and "updatedAt" > now() - interval '24 hours')::int as "failed24h",
                       min("updatedAt") filter (where status = 'queued') as "oldestQueued",
                       count(*) filter (where status = 'uploading' and "updatedAt" < now() - interval '1 day')::int as "staleUploads"
                  from "asset"`),
    pool.query(`select a.id, a.title, a.error, a.attempts, a."updatedAt", o.name as "workspaceName" from "asset" a join "organization" o on o.id = a."organizationId"
                 where a.status = 'failed' order by a."updatedAt" desc limit 25`),
    pool.query(`select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'processing')::int as processing,
                       count(*) filter (where status = 'failed')::int as failed, count(*) filter (where status = 'ready')::int as ready from "caption"`),
    pool.query(`select c."assetId", c.error, c."updatedAt", a.title from "caption" c join "asset" a on a.id = c."assetId" where c.status = 'failed' order by c."updatedAt" desc limit 10`),
    pool.query(`select e.id, e.url, e.failures, e.enabled, o.name as "workspaceName",
                       (select max(d."createdAt") from "webhook_delivery" d where d."endpointId" = e.id and d.status = 'succeeded') as "lastSuccess"
                  from "webhook_endpoint" e join "organization" o on o.id = e."organizationId" where e.failures > 0 order by e.failures desc limit 20`),
    pool.query(`select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'failed' and "createdAt" > now() - interval '24 hours')::int as "failed24h",
                       count(*) filter (where status = 'succeeded' and "createdAt" > now() - interval '24 hours')::int as "succeeded24h" from "webhook_delivery"`),
  ])
  const store = storage()
  let disk: { free: number; total: number } | null = null
  if (store.kind === 'local') {
    try {
      const s = await statfs(path.resolve(process.env.MEDIA_DIR || '.media'))
      disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }
    } catch {}
  }
  const have = await encoders()
  return {
    pipeline: pipe,
    failedAssets: failed,
    captions: { ...cc, failedList: ccFailed, available: captionsAvailable() },
    webhooks: { ...hk, failingEndpoints: hooks },
    health: {
      db,
      storage: { kind: store.kind, durable: store.kind === 's3' || Boolean(process.env.MEDIA_DIR), disk },
      ffmpeg: {
        found: have.size > 0,
        h264: (await encoderFor('h264'))?.name ?? null,
        hevc: (await encoderFor('hevc'))?.name ?? null,
        av1: (await encoderFor('av1'))?.name ?? null,
        hardware: process.env.MEDIA_HW_ENCODER || null,
      },
      providers: {
        billing: billingProvider(),
        openai: captionsAvailable(),
        anthropic: aiAvailable(),
        email: Boolean(process.env.RESEND_API_KEY),
        google: Boolean(process.env.GOOGLE_CLIENT_ID),
        github: Boolean(process.env.GITHUB_CLIENT_ID),
      },
      worker: process.env.MEDIA_WORKER !== 'off',
      node: process.version,
      uptimeSeconds: Math.round((Date.now() - started) / 1000),
    },
  }
}

/* ------------------------------------------------ audit and admins */
async function auditLog(sp: URLSearchParams) {
  const { limit, offset } = page(sp, 200)
  const where: string[] = []
  const args: unknown[] = []
  const arg = (v: unknown) => (args.push(v), `$${args.length}`)
  const q = sp.get('q')?.trim()
  if (q) where.push(`("adminEmail" ilike ${arg(like(q))} or action ilike ${arg(like(q))} or "targetId" = ${arg(q)} or details::text ilike ${arg(like(q))})`)
  const action = sp.get('action')
  if (action) where.push(`action like ${arg(`${action}%`)}`)
  const w = where.length ? `where ${where.join(' and ')}` : ''
  const { rows } = await pool.query(`select * from "admin_audit" ${w} order by "createdAt" desc limit ${limit} offset ${offset}`, args)
  const { rows: [t] } = await pool.query(`select count(*)::int as total from "admin_audit" ${w}`, args)
  return { entries: rows, total: t.total, limit, offset }
}

async function admins() {
  const env = siteAdminEmails()
  const { rows } = await pool.query(
    `select u.id, u.name, u.email, u."createdAt", (select max(s."updatedAt") from "session" s where s."userId" = u.id) as "lastSeenAt"
       from "user" u where u.role = 'admin' order by u."createdAt"`,
  )
  return { admins: rows.map((r) => ({ ...r, bootstrap: env.includes(r.email.toLowerCase()) })), pending: env.filter((e) => !rows.some((r) => r.email.toLowerCase() === e)) }
}

/* ------------------------------------------------ router */
export async function handleAdmin(req: Request, parts: string[]) {
  return handle(async () => {
    const a = await requireAdmin(req.headers)
    const [, , area, raw, sub] = parts // api, admin, area, id?, action?
    const m = req.method
    const sp = new URL(req.url).searchParams
    const id = raw === undefined ? undefined : decodeURIComponent(raw)
    if (parts.length > 5) throw new HttpError(404, 'Not found')

    if (area === 'me' && m === 'GET') return Response.json({ admin: a }, { headers: noStore })
    if (area === 'overview' && m === 'GET') return Response.json(await overview(), { headers: noStore })

    if (area === 'users') {
      if (!id && m === 'GET') return Response.json(await listUsers(sp), { headers: noStore })
      if (id && !sub && m === 'GET') return Response.json({ ...(await oneUser(id)), soleWorkspaces: await soleWorkspaces(id) }, { headers: noStore })
      if (id && !sub && m === 'DELETE') return deleteUser(a, req, id)
      if (id && sub && m === 'POST') return userAction(a, req, id, sub)
    }
    if (area === 'workspaces') {
      if (!id && m === 'GET') return Response.json(await listWorkspaces(sp), { headers: noStore })
      if (id && !sub && m === 'GET') return Response.json(await oneWorkspace(id), { headers: noStore })
      if (id && !sub && m === 'DELETE') {
        const { rows: [o] } = await pool.query<{ name: string }>('select name from "organization" where id = $1', [id])
        if (!o) throw new HttpError(404, 'That workspace doesn’t exist.')
        const n = await deleteWorkspace(id)
        await audit({ adminId: a.id, action: 'workspace.delete', targetType: 'workspace', targetId: id, details: { name: o.name, assetsDeleted: n } })
        return new Response(null, { status: 204 })
      }
      if (id && sub && m === 'POST') return workspaceAction(a, req, id, sub)
    }
    if (area === 'assets') {
      if (!id && m === 'GET') return Response.json(await listAssets(sp), { headers: noStore })
      if (id && sub === 'thumb' && m === 'GET') return assetThumb(id, req)
      if (id && !sub && m === 'DELETE') return deleteAsset(a, id)
      if (id && sub && m === 'POST') return assetAction(a, req, id, sub)
    }
    if (area === 'billing' && !id && m === 'GET') return Response.json(await billing(), { headers: noStore })
    if (area === 'ops') {
      if (!id && m === 'GET') return Response.json(await ops(), { headers: noStore })
      if (id === 'retry-failed' && m === 'POST') {
        const { rows } = await pool.query<{ id: string }>(
          `update "asset" set status = 'queued', stage = 1, progress = 0, error = null, attempts = 0, "updatedAt" = now()
            where status = 'failed' and "updatedAt" > now() - interval '24 hours' returning id`,
        )
        kickWorker()
        await audit({ adminId: a.id, action: 'ops.retry-failed', targetType: 'platform', targetId: null, details: { count: rows.length } })
        return Response.json({ requeued: rows.length })
      }
    }
    if (area === 'audit' && !id && m === 'GET') return Response.json(await auditLog(sp), { headers: noStore })
    if (area === 'admins') {
      if (!id && m === 'GET') return Response.json(await admins(), { headers: noStore })
      if (!id && m === 'POST') {
        const b = await body<{ email?: unknown }>(req)
        const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
        const { rows: [u] } = await pool.query<{ id: string; email: string }>('select id, email from "user" where lower(email) = $1', [email])
        if (!u) throw new HttpError(404, 'There’s no MediaEX account with that email. They need to sign up first.')
        await setRole(a, u, 'admin', req.headers)
        return Response.json(await admins())
      }
      if (id && m === 'DELETE') {
        const { rows: [u] } = await pool.query<{ id: string; email: string }>('select id, email from "user" where id = $1', [id])
        if (!u) throw new HttpError(404, 'That user doesn’t exist.')
        await setRole(a, u, 'user', req.headers)
        return Response.json(await admins())
      }
    }
    throw new HttpError(404, 'Not found')
  })
}
