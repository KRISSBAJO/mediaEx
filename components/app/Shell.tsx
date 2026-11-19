'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import Logo from '@/components/Logo'
import { ASSETS, USAGE, USER, WORKSPACE, WORKSPACES, getAsset } from '@/lib/sample'
import Icon from './Icon'
import { Avatar, Meter, Toaster, toast } from './ui'

const NAV = [
  {
    group: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Overview', icon: 'overview' },
      { href: '/dashboard/library', label: 'Library', icon: 'library', count: ASSETS.length },
      { href: '/dashboard/uploads', label: 'Uploads', icon: 'upload', count: ASSETS.filter((a) => a.status === 'processing' || a.status === 'queued').length },
      { href: '/dashboard/analytics', label: 'Analytics', icon: 'analytics' },
    ],
  },
  {
    group: 'Build',
    items: [
      { href: '/dashboard/developers', label: 'Developers', icon: 'code' },
      { href: '/dashboard/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]
const ALL_PAGES = NAV.flatMap((g) => g.items)

function isActive(path: string, href: string) {
  return href === '/dashboard' ? path === '/dashboard' : path === href || path.startsWith(`${href}/`)
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const on = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', on)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', on)
      document.removeEventListener('keydown', key)
    }
  }, [open, close])
  return ref
}

/* ------------------------------------------------ sidebar */
function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname()
  const router = useRouter()
  const [ws, setWs] = useState(false)
  const [me, setMe] = useState(false)
  const wsRef = useOutside(ws, () => setWs(false))
  const meRef = useOutside(me, () => setMe(false))
  const s = USAGE.storage

  return (
    <div className="side-inner">
      <Link href="/" className="brand side-brand" onClick={onNavigate}>
        <Logo size={24} />
        <span>
          Media<b>EX</b>
        </span>
      </Link>

      <div className="menu-wrap" ref={wsRef}>
        <button type="button" className="ws" aria-haspopup="menu" aria-expanded={ws} onClick={() => setWs((o) => !o)}>
          <span className="ws-mark">{WORKSPACE.initial}</span>
          <span className="ws-text">
            <b>{WORKSPACE.name}</b>
            <em>{WORKSPACE.plan} plan</em>
          </span>
          <Icon name="updown" size={15} />
        </button>
        {ws && (
          <div className="menu" role="menu">
            <span className="menu-label">Workspaces</span>
            {WORKSPACES.map((w) => (
              <button
                key={w.slug}
                type="button"
                role="menuitem"
                onClick={() => {
                  setWs(false)
                  if (w.slug !== WORKSPACE.slug) toast(`Switching workspaces needs the backend — showing ${WORKSPACE.name}`)
                }}
              >
                <span className="ws-mark sm">{w.initial}</span>
                {w.name}
                {w.slug === WORKSPACE.slug && <Icon name="check" size={15} className="menu-check" />}
              </button>
            ))}
            <hr />
            <button type="button" role="menuitem" onClick={() => (setWs(false), toast('Workspace creation needs the backend'))}>
              <Icon name="plus" size={15} /> New workspace
            </button>
          </div>
        )}
      </div>

      <nav className="side-nav" aria-label="Dashboard">
        {NAV.map((g) => (
          <div key={g.group} className="side-group">
            <span className="side-label">{g.group}</span>
            {g.items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={isActive(path, it.href) ? 'is-active' : ''}
                aria-current={isActive(path, it.href) ? 'page' : undefined}
                onClick={onNavigate}
              >
                <Icon name={it.icon} />
                {it.label}
                {'count' in it && it.count ? <em>{it.count}</em> : null}
              </Link>
            ))}
          </div>
        ))}
        <div className="side-group">
          <span className="side-label">Resources</span>
          <Link href="/#developers" onClick={onNavigate}>
            <Icon name="book" />
            Docs
            <Icon name="external" size={13} className="side-ext" />
          </Link>
        </div>
      </nav>

      <div className="side-foot">
        <div className="usage">
          <div className="usage-row">
            <span>Storage</span>
            <b>
              {s.used} / {s.limit} {s.unit}
            </b>
          </div>
          <Meter value={s.used} max={s.limit} />
          <Link href="/dashboard/settings?tab=billing" className="usage-link" onClick={onNavigate}>
            Manage plan <Icon name="arrowRight" size={13} />
          </Link>
        </div>

        <div className="menu-wrap" ref={meRef}>
          <button type="button" className="me" aria-haspopup="menu" aria-expanded={me} onClick={() => setMe((o) => !o)}>
            <Avatar initials={USER.initials} size={30} />
            <span className="ws-text">
              <b>{USER.name}</b>
              <em>{USER.email}</em>
            </span>
            <Icon name="more" size={16} />
          </button>
          {me && (
            <div className="menu menu-up" role="menu">
              <Link href="/dashboard/settings" role="menuitem" onClick={() => (setMe(false), onNavigate?.())}>
                <Icon name="settings" size={15} /> Account settings
              </Link>
              <Link href="/" role="menuitem" onClick={() => setMe(false)}>
                <Icon name="external" size={15} /> MediaEX home
              </Link>
              <hr />
              <button type="button" role="menuitem" onClick={() => router.push('/sign-in')}>
                <Icon name="logout" size={15} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------ command menu (Ctrl / ⌘ K) */
type Cmd = { id: string; group: string; label: string; hint?: string; icon: string; run: () => void }

function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const cmds = useMemo<Cmd[]>(() => {
    const go = (href: string) => () => router.push(href)
    return [
      ...ALL_PAGES.map((p) => ({ id: p.href, group: 'Pages', label: p.label, icon: p.icon, run: go(p.href) })),
      { id: 'a-upload', group: 'Actions', label: 'Upload files', icon: 'upload', hint: 'U', run: go('/dashboard/uploads') },
      { id: 'a-key', group: 'Actions', label: 'Create API key', icon: 'key', run: go('/dashboard/developers?new=1') },
      { id: 'a-invite', group: 'Actions', label: 'Invite a teammate', icon: 'users', run: go('/dashboard/settings?tab=team') },
      ...ASSETS.map((a) => ({ id: a.id, group: 'Assets', label: a.title, icon: a.type, hint: a.status, run: go(`/dashboard/library/${a.id}`) })),
    ]
  }, [router])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const hits = s ? cmds.filter((c) => c.label.toLowerCase().includes(s)) : cmds.filter((c) => c.group !== 'Assets').concat(cmds.filter((c) => c.group === 'Assets').slice(0, 4))
    return hits.slice(0, 14)
  }, [q, cmds])

  useEffect(() => {
    if (open) {
      setQ('')
      setI(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])
  useEffect(() => setI(0), [q])

  if (!open) return null

  const run = (c?: Cmd) => {
    if (!c) return
    onClose()
    c.run()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setI((x) => Math.min(list.length - 1, x + 1))
    else if (e.key === 'ArrowUp') setI((x) => Math.max(0, x - 1))
    else if (e.key === 'Enter') run(list[i])
    else if (e.key === 'Escape') onClose()
    else return
    e.preventDefault()
  }

  let lastGroup = ''
  return (
    <div className="cmdk-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div className="cmdk-input">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search assets, pages and actions…"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={list[i] ? `cmd-${list[i].id}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox">
          {list.length === 0 && <p className="cmdk-empty">No results for “{q}”.</p>}
          {list.map((c, idx) => {
            const head = c.group !== lastGroup
            lastGroup = c.group
            return (
              <div key={c.id}>
                {head && <span className="cmdk-group">{c.group}</span>}
                <button
                  id={`cmd-${c.id}`}
                  type="button"
                  role="option"
                  aria-selected={idx === i}
                  className={idx === i ? 'is-on' : ''}
                  onPointerMove={() => setI(idx)}
                  onClick={() => run(c)}
                >
                  <Icon name={c.icon} size={16} />
                  <span>{c.label}</span>
                  {c.hint && <em>{c.hint}</em>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="cmdk-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------ top bar */
function crumbs(path: string) {
  const out: { href: string; label: string }[] = [{ href: '/dashboard', label: WORKSPACE.name }]
  const parts = path.split('/').filter(Boolean).slice(1)
  let href = '/dashboard'
  for (const p of parts) {
    href += `/${p}`
    const page = ALL_PAGES.find((x) => x.href === href)
    out.push({ href, label: page?.label ?? getAsset(p)?.title ?? p })
  }
  if (out.length === 1) out.push({ href: '/dashboard', label: 'Overview' })
  return out
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const [drawer, setDrawer] = useState(false)
  const [cmd, setCmd] = useState(false)
  const [mac, setMac] = useState(false)

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform))
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmd((o) => !o)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  useEffect(() => setDrawer(false), [path])
  useEffect(() => {
    if (!drawer) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    window.addEventListener('keydown', key)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', key)
    }
  }, [drawer])

  const trail = crumbs(path)

  return (
    <div className={`app ${drawer ? 'drawer-open' : ''}`}>
      <aside className="side" aria-label="Sidebar">
        <Sidebar onNavigate={() => setDrawer(false)} />
      </aside>
      <div className="side-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn top-burger" aria-label="Open menu" onClick={() => setDrawer(true)}>
            <Icon name="menu" />
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            {trail.map((c, i) => (
              <span key={`${c.href}-${i}`}>
                {i > 0 && <Icon name="chevron" size={14} />}
                {i === trail.length - 1 ? (
                  <b aria-current="page">{c.label}</b>
                ) : (
                  <Link href={c.href} className={i === 0 ? 'crumb-ws' : ''}>
                    {c.label}
                  </Link>
                )}
              </span>
            ))}
          </nav>
          <div className="top-actions">
            <span className="sample-pill" title="MediaEX has no backend yet. Numbers on these pages are generated sample data.">
              Sample data
            </span>
            <button type="button" className="search-btn" onClick={() => setCmd(true)}>
              <Icon name="search" size={16} />
              <span>Search</span>
              <kbd>{mac ? '⌘' : 'Ctrl'} K</kbd>
            </button>
            <button type="button" className="icon-btn" aria-label="Notifications, 2 unread" onClick={() => toast('2 unread: a failed packaging job and 3 new review comments')}>
              <Icon name="bell" />
              <i className="bell-dot" />
            </button>
            <Link href="/dashboard/uploads" className="btn btn-primary btn-sm top-upload">
              <Icon name="upload" size={16} />
              <span>Upload</span>
            </Link>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      <CommandMenu open={cmd} onClose={() => setCmd(false)} />
      <Toaster />
    </div>
  )
}
