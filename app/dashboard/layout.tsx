import type { Metadata } from 'next'
import { headers } from 'next/headers'
import type { Account, Role } from '@/components/app/account'
import Shell from '@/components/app/Shell'
import { auth, createPersonalWorkspace, pool } from '@/lib/auth'
import { requireSession } from '@/lib/session'
import './dashboard.css'

export const metadata: Metadata = {
  title: { template: '%s · MediaEX', default: 'Dashboard · MediaEX' },
  robots: { index: false, follow: false },
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, session } = await requireSession()
  const h = await headers()

  let orgs = await auth.api.listOrganizations({ headers: h })
  if (!orgs.length) {
    // e.g. the user deleted their only workspace: give them a fresh one rather than an empty app
    await createPersonalWorkspace(user.id, user.name)
    orgs = await auth.api.listOrganizations({ headers: h })
  }
  const active = orgs.find((o) => o.id === session.activeOrganizationId) ?? orgs[0]
  if (session.activeOrganizationId !== active.id) {
    // new sign-ups get their workspace just after the session is created, so record it as active here
    await pool.query('update "session" set "activeOrganizationId" = $1 where id = $2', [active.id, session.id])
  }
  const { rows } = await pool.query<{ role: string }>('select role from "member" where "userId" = $1 and "organizationId" = $2 limit 1', [user.id, active.id])
  const role = (rows[0]?.role ?? 'member').split(',')[0] as Role

  const account: Account = {
    user: { id: user.id, name: user.name, email: user.email, initials: initials(user.name), emailVerified: user.emailVerified },
    workspace: {
      id: active.id,
      name: active.name,
      slug: active.slug,
      initial: active.name[0]?.toUpperCase() ?? 'W',
      role,
      createdAt: new Date(active.createdAt).toISOString(),
    },
    workspaces: orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, initial: o.name[0]?.toUpperCase() ?? 'W' })),
  }

  return <Shell account={account}>{children}</Shell>
}
