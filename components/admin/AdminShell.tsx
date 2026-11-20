'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Logo from '@/components/Logo'
import { authClient } from '@/lib/auth-client'
import Icon from '../app/Icon'
import { Avatar, Toaster } from '../app/ui'

const NAV = [
  {
    group: 'Platform',
    items: [
      { href: '/admin', label: 'Overview', icon: 'overview' },
      { href: '/admin/users', label: 'Users', icon: 'users' },
      { href: '/admin/workspaces', label: 'Workspaces', icon: 'layers' },
      { href: '/admin/media', label: 'Media', icon: 'library' },
    ],
  },
  {
    group: 'Business',
    items: [{ href: '/admin/billing', label: 'Billing', icon: 'card' }],
  },
  {
    group: 'Run',
    items: [
      { href: '/admin/operations', label: 'Operations', icon: 'analytics' },
      { href: '/admin/audit', label: 'Audit log', icon: 'clock' },
      { href: '/admin/admins', label: 'Admins', icon: 'key' },
    ],
  },
]
const active = (path: string, href: string) => (href === '/admin' ? path === '/admin' : path === href || path.startsWith(`${href}/`))
const LABEL: Record<string, string> = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.href, i.label])))

export default function AdminShell({ admin, children }: { admin: { name: string; email: string }; children: React.ReactNode }) {
  const path = usePathname()
  const router = useRouter()
  const [drawer, setDrawer] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => setDrawer(false), [path])
  const section = NAV.flatMap((g) => g.items).find((i) => active(path, i.href))
  const initials = admin.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'A'

  return (
    <div className={`app is-admin ${drawer ? 'drawer-open' : ''}`}>
      <aside className="side" aria-label="Site admin">
        <div className="side-inner">
          <Link href="/admin" className="brand side-brand admin-brand">
            <Logo size={19} />
            <span className="admin-tag">Admin</span>
          </Link>
          <nav className="side-nav" aria-label="Site admin">
            {NAV.map((g) => (
              <div key={g.group} className="side-group">
                <span className="side-label">{g.group}</span>
                {g.items.map((it) => (
                  <Link key={it.href} href={it.href} className={active(path, it.href) ? 'is-active' : ''} aria-current={active(path, it.href) ? 'page' : undefined}>
                    <Icon name={it.icon} />
                    {it.label}
                  </Link>
                ))}
              </div>
            ))}
            <div className="side-group">
              <span className="side-label">You</span>
              <Link href="/dashboard">
                <Icon name="external" />
                My dashboard
              </Link>
            </div>
          </nav>
          <div className="side-foot">
            <div className="admin-me">
              <Avatar initials={initials} size={30} />
              <span>
                <b>{admin.name}</b>
                <small>{admin.email}</small>
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Sign out"
                onClick={async () => {
                  await authClient.signOut()
                  router.replace('/sign-in')
                }}
              >
                <Icon name="logout" size={16} />
              </button>
            </div>
          </div>
        </div>
      </aside>
      <div className="side-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn top-burger" aria-label="Open menu" onClick={() => setDrawer(true)}>
            <Icon name="menu" />
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            <span>
              <Link href="/admin" className="crumb-ws">
                Site admin
              </Link>
            </span>
            {section && section.href !== '/admin' && (
              <span>
                <Icon name="chevron" size={14} />
                <b aria-current="page">{LABEL[section.href]}</b>
              </span>
            )}
          </nav>
          <form
            className="admin-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              const s = q.trim()
              if (!s) return
              // ids go straight to their page; everything else searches users (by name or email)
              if (/^ast_/.test(s)) router.push(`/admin/media?q=${encodeURIComponent(s)}`)
              else router.push(`/admin/users?q=${encodeURIComponent(s)}`)
              setQ('')
            }}
          >
            <Icon name="search" size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a user by email, or an asset ID" aria-label="Search users or assets" />
          </form>
        </header>
        <main className="content">{children}</main>
      </div>
      <Toaster />
    </div>
  )
}
