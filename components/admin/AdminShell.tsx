'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Logo from '@/components/Logo'
import { authClient } from '@/lib/auth-client'
import Icon from '../app/Icon'
import SideNav from '../app/SideNav'
import { Avatar, Toaster } from '../app/ui'

const NAV = [
  {
    group: 'Platform',
    items: [
      { href: '/admin', label: 'Overview', icon: 'overview' },
      { href: '/admin/users', label: 'Users', icon: 'users' },
      { href: '/admin/workspaces', label: 'Workspaces', icon: 'building' },
      { href: '/admin/media', label: 'Media', icon: 'film' },
    ],
  },
  {
    group: 'Business',
    items: [{ href: '/admin/billing', label: 'Billing', icon: 'card' }],
  },
  {
    group: 'Run',
    items: [
      { href: '/admin/operations', label: 'Operations', icon: 'pulse' },
      { href: '/admin/audit', label: 'Audit log', icon: 'audit' },
      { href: '/admin/admins', label: 'Admins', icon: 'shield' },
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
          <div className="side-head">
            <Link href="/admin" className="brand side-brand">
              <Logo size={19} />
            </Link>
            <span className="admin-tag">
              <Icon name="shield" size={12} />
              Admin
            </span>
          </div>
          <div className="admin-banner">
            <span className="admin-banner-dot" aria-hidden="true" />
            <span>
              <b>Site admin</b>
              <em>Changes affect every workspace</em>
            </span>
          </div>
          <SideNav label="Site admin" groups={NAV} isActive={(href) => active(path, href)} />
          <div className="side-foot">
            <Link href="/dashboard" className="admin-back">
              <Icon name="arrowLeft" size={15} />
              My dashboard
            </Link>
            <div className="admin-me">
              <Avatar initials={initials} size={30} />
              <span className="ws-text">
                <b>{admin.name}</b>
                <em>{admin.email}</em>
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Sign out"
                title="Sign out"
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
