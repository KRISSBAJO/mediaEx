import { randomUUID } from 'node:crypto'
import { auth, isVerifiedAdmin, personalWorkspaceName, pool } from './auth.mts'
import { PLANS, planOf } from './media/billing.mts'

type Workspace = { id: string; name: string; slug: string; createdAt: Date; role: string }

const memberships = `select o.id, o.name, o.slug, o."createdAt", m.role
  from "organization" o join "member" m on m."organizationId" = o.id
  where m."userId" = $1 order by m."createdAt", o.id`

async function getWorkspaces(userId: string, name: string) {
  const existing = await pool.query<Workspace>(memberships, [userId])
  if (existing.rows.length) return existing.rows

  // Two simultaneous dashboard requests after the last workspace was deleted must create only one replacement.
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select id from "user" where id = $1 for update', [userId])
    let { rows } = await client.query<Workspace>(memberships, [userId])
    if (!rows.length) {
      const org = personalWorkspaceName(name)
      const orgId = randomUUID()
      await client.query('insert into "organization" (id, name, slug, "createdAt") values ($1, $2, $3, now())', [orgId, org.name, org.slug])
      await client.query('insert into "member" (id, "organizationId", "userId", role, "createdAt") values ($1, $2, $3, $4, now())', [randomUUID(), orgId, userId, 'owner'])
      rows = (await client.query<Workspace>(memberships, [userId])).rows
    }
    await client.query('commit')
    return rows
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

const summary = ({ id, name, slug }: Workspace) => ({ id, name, slug, initial: name[0]?.toUpperCase() ?? 'W' })

export async function getAccount(headers: Headers) {
  const current = await auth.api.getSession({ headers })
  if (!current) return null
  const { user, session } = current
  const workspaces = await getWorkspaces(user.id, user.name)
  const active = workspaces.find((workspace) => workspace.id === session.activeOrganizationId) ?? workspaces[0]
  if (active.id !== session.activeOrganizationId) {
    await pool.query(
      'update "session" set "activeOrganizationId" = $1 where id = $2 and "userId" = $3 and "activeOrganizationId" is not distinct from $4',
      [active.id, session.id, user.id, session.activeOrganizationId ?? null],
    )
  }
  const plan = await planOf(active.id)
  const { rows: susp } = await pool.query<{ suspendReason: string | null }>(
    'select "suspendReason" from "workspace_admin" where "organizationId" = $1 and "suspendedAt" is not null',
    [active.id],
  )
  const by = (session as { impersonatedBy?: string | null }).impersonatedBy
  const impersonator = by ? (await pool.query<{ name: string; email: string }>('select name, email from "user" where id = $1', [by])).rows[0] : null
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
  return {
    user: {
      id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, initials,
      // never an admin while someone is impersonating them
      isAdmin: isVerifiedAdmin(user, { impersonatedBy: by }),
    },
    impersonation: impersonator ? { by: impersonator.name, byEmail: impersonator.email, expiresAt: new Date(session.expiresAt).toISOString() } : null,
    workspace: {
      ...summary(active),
      role: active.role.split(',')[0],
      createdAt: new Date(active.createdAt).toISOString(),
      plan: { id: plan, name: PLANS[plan].name, storageLimit: PLANS[plan].storageBytes ?? 10e12 },
      suspended: susp[0] ? { reason: susp[0].suspendReason } : null,
    },
    workspaces: workspaces.map(summary),
  }
}

export async function getInvitation(id: string) {
  const { rows } = await pool.query(
    `select i.id, i.email, i.role, i.status, i."expiresAt", o.name as org, u.name as inviter
      from "invitation" i join "organization" o on o.id = i."organizationId"
      join "user" u on u.id = i."inviterId" where i.id = $1`,
    [id],
  )
  return rows[0] ?? null
}
