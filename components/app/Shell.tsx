'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import Logo from '@/components/Logo'
import { authClient, authMessage } from '@/lib/auth-client'
import { isActive as inPipeline, type MediaAsset } from '@/lib/media/types'
import { bytes } from '@/lib/sample'
import { AccountProvider, useAccount, type Account } from './account'
import { LibraryProvider, useLibrary } from './library'
import { MediaProvider, useMedia } from './media'
import Icon from './Icon'
import { Avatar, Meter, Toaster, toast } from './ui'


const NAV = [
  {
    group: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Overview', icon: 'overview' },
      { href: '/dashboard/library', label: 'Library', icon: 'library' },
      { href: '/dashboard/uploads', label: 'Uploads', icon: 'upload' },
      { href: '/dashboard/review', label: 'Review', icon: 'check' },
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
function Sidebar({ onNavigate, onNewWorkspace }: { onNavigate?: () => void; onNewWorkspace: () => void }) {
  const path = usePathname()
  const router = useRouter()
  const { user, workspace, workspaces } = useAccount()
  const [ws, setWs] = useState(false)
  const [me, setMe] = useState(false)
  const [busy, setBusy] = useState(false)

  const switchTo = async (id: string) => {
    setWs(false)
    if (id === workspace.id) return
    setBusy(true)
    const { error } = await authClient.organization.setActive({ organizationId: id })
    setBusy(false)
    if (error) return toast(authMessage(error, 'Couldn’t switch workspace'))
    router.refresh()
  }
  const signOut = async () => {
    setMe(false)
    await authClient.signOut()
    router.replace('/sign-in')
    router.refresh()
  }
  const wsRef = useOutside(ws, () => setWs(false))
  const meRef = useOutside(me, () => setMe(false))
  const { assets } = useMedia()
  const counts: Record<string, number> = {
    '/dashboard/library': assets.filter((a) => a.status !== 'uploading').length,
    '/dashboard/uploads': assets.filter(inPipeline).length,
    '/dashboard/review': assets.filter((a) => a.moderation === 'pending').length,
  }
  const used = assets.reduce((t, a) => t + a.size + a.outputSize, 0)

  return (
    <div className="side-inner">
      <Link href="/" className="brand side-brand" onClick={onNavigate}>
        <Logo size={20} />
      </Link>

      <div className="menu-wrap" ref={wsRef}>
        <button type="button" className="ws" aria-haspopup="menu" aria-expanded={ws} onClick={() => setWs((o) => !o)}>
          <span className="ws-mark">{workspace.initial}</span>
          <span className="ws-text">
            <b>{workspace.name}</b>
            <em>{busy ? 'Switching…' : `${workspace.role[0].toUpperCase()}${workspace.role.slice(1)} · ${workspace.plan.name}`}</em>
          </span>
          <Icon name="updown" size={15} />
        </button>
        {ws && (
          <div className="menu" role="menu">
            <span className="menu-label">Workspaces</span>
            {workspaces.map((w) => (
              <button key={w.id} type="button" role="menuitem" onClick={() => switchTo(w.id)}>
                <span className="ws-mark sm">{w.initial}</span>
                {w.name}
                {w.id === workspace.id && <Icon name="check" size={15} className="menu-check" />}
              </button>
            ))}
            <hr />
            <button type="button" role="menuitem" onClick={() => (setWs(false), onNewWorkspace())}>
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
                {counts[it.href] ? <em>{counts[it.href]}</em> : null}
              </Link>
            ))}
          </div>
        ))}
        <div className="side-group">
          <span className="side-label">Resources</span>
          <Link href="/#developers" onClick={onNavigate}>
            <Icon name="book" />
            API overview
            <Icon name="external" size={13} className="side-ext" />
          </Link>
        </div>
      </nav>

      <div className="side-foot">
        <div className="usage">
          <div className="usage-row">
            <span>Storage</span>
            <b>
              {used ? bytes(used) : '0 GB'} / {bytes(workspace.plan.storageLimit)}
            </b>
          </div>
          <Meter value={used} max={workspace.plan.storageLimit} />
          <Link href="/dashboard/settings?tab=billing" className="usage-link" onClick={onNavigate}>
            Manage plan <Icon name="arrowRight" size={13} />
          </Link>
        </div>

        <div className="menu-wrap" ref={meRef}>
          <button type="button" className="me" aria-haspopup="menu" aria-expanded={me} onClick={() => setMe((o) => !o)}>
            <Avatar initials={user.initials} size={30} />
            <span className="ws-text">
              <b>{user.name}</b>
              <em>{user.email}</em>
            </span>
            <Icon name="more" size={16} />
          </button>
          {me && (
            <div className="menu menu-up" role="menu">
              <Link href="/dashboard/settings?tab=account" role="menuitem" onClick={() => (setMe(false), onNavigate?.())}>
                <Icon name="settings" size={15} /> Account settings
              </Link>
              <Link href="/" role="menuitem" onClick={() => setMe(false)}>
                <Icon name="external" size={15} /> MediaEX home
              </Link>
              {user.isAdmin && (
                <Link href="/admin" role="menuitem" onClick={() => setMe(false)}>
                  <Icon name="key" size={15} /> Site admin
                </Link>
              )}
              <hr />
              <button type="button" role="menuitem" onClick={signOut}>
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
  const { assets } = useMedia()
  const { folders, collections, folderPath } = useLibrary()

  const cmds = useMemo<Cmd[]>(() => {
    const go = (href: string) => () => router.push(href)
    return [
      ...ALL_PAGES.map((p) => ({ id: p.href, group: 'Pages', label: p.label, icon: p.icon, run: go(p.href) })),
      { id: 'a-upload', group: 'Actions', label: 'Upload files', icon: 'upload', hint: 'U', run: go('/dashboard/uploads') },
      { id: 'a-key', group: 'Actions', label: 'Create API key', icon: 'key', run: go('/dashboard/developers?new=1') },
      { id: 'a-invite', group: 'Actions', label: 'Invite a teammate', icon: 'users', run: go('/dashboard/settings?tab=team') },
      ...folders.map((f) => ({
        id: f.id,
        group: 'Folders',
        label: folderPath(f.id).map((x) => x.name).join(' / '),
        icon: 'library',
        hint: String(f.assetCount),
        run: go(`/dashboard/library?folder=${f.id}`),
      })),
      ...collections.map((c) => ({ id: c.id, group: 'Collections', label: c.name, icon: 'layers', hint: String(c.assetCount), run: go(`/dashboard/library?collection=${c.id}`) })),
      ...assets.map((a) => ({ id: a.id, group: 'Assets', label: a.title, icon: a.type, hint: a.status, run: go(`/dashboard/library/${a.id}`) })),
    ]
  }, [router, assets, folders, collections, folderPath])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const hits = s ? cmds.filter((c) => c.label.toLowerCase().includes(s)) : cmds.filter((c) => c.group === 'Pages' || c.group === 'Actions').concat(cmds.filter((c) => c.group === 'Assets').slice(0, 4))
    return hits.slice(0, 16)
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
function crumbs(path: string, workspaceName: string, assets: MediaAsset[]) {
  const out: { href: string; label: string }[] = [{ href: '/dashboard', label: workspaceName }]
  const parts = path.split('/').filter(Boolean).slice(1)
  let href = '/dashboard'
  for (const p of parts) {
    href += `/${p}`
    const page = ALL_PAGES.find((x) => x.href === href)
    out.push({ href, label: page?.label ?? assets.find((a) => a.id === p)?.title ?? 'Asset' })
  }
  if (out.length === 1) out.push({ href: '/dashboard', label: 'Overview' })
  return out
}

export default function Shell({ account, initialAssets, children }: { account: Account; initialAssets: MediaAsset[]; children: React.ReactNode }) {
  return (
    <AccountProvider value={account}>
      {/* keyed by workspace so switching workspaces starts from that workspace's media */}
      <MediaProvider key={account.workspace.id} initial={initialAssets}>
        <LibraryProvider>
          <ShellInner>{children}</ShellInner>
        </LibraryProvider>
      </MediaProvider>
    </AccountProvider>
  )
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const account = useAccount()
  const { assets } = useMedia()
  const failed = assets.filter((a) => a.status === 'failed').length
  const path = usePathname()
  const [drawer, setDrawer] = useState(false)
  const [cmd, setCmd] = useState(false)
  const [mac, setMac] = useState(false)
  const [newWs, setNewWs] = useState(false)

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

  const trail = crumbs(path, account.workspace.name, assets)
  const imp = account.impersonation
  const suspended = account.workspace.suspended

  return (
    <>
    {imp && <ImpersonationBar name={account.user.name} email={account.user.email} by={imp.by} expiresAt={imp.expiresAt} />}
    <div className={`app ${drawer ? 'drawer-open' : ''}`}>
      <aside className="side" aria-label="Sidebar">
        <Sidebar onNavigate={() => setDrawer(false)} onNewWorkspace={() => setNewWs(true)} />
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
            <button type="button" className="search-btn" onClick={() => setCmd(true)}>
              <Icon name="search" size={16} />
              <span>Search</span>
              <kbd>{mac ? '⌘' : 'Ctrl'} K</kbd>
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={failed ? `Notifications, ${failed} unread` : 'Notifications'}
              onClick={() => toast(failed ? `${failed} asset${failed > 1 ? 's' : ''} failed processing — see Library › Needs attention` : 'You’re all caught up')}
            >
              <Icon name="bell" />
              {failed > 0 && <i className="bell-dot" />}
            </button>
            <Link href="/dashboard/uploads" className="btn btn-primary btn-sm top-upload">
              <Icon name="upload" size={16} />
              <span>Upload</span>
            </Link>
          </div>
        </header>
        <main className="content">
          {suspended ? (
            <div className="suspended-screen" role="alert">
              <div>
                <Icon name="alert" size={26} />
                <h1>This workspace is suspended</h1>
                <p>
                  {suspended.reason ? `${suspended.reason}. ` : ''}Its media isn’t playing for anyone outside the workspace, and nothing new can be uploaded or encoded. Contact MediaEX
                  support to sort it out. You can switch to another workspace from the menu.
                </p>
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      <CommandMenu open={cmd} onClose={() => setCmd(false)} />
      {newWs && <NewWorkspace onClose={() => setNewWs(false)} />}
      <Toaster />
    </div>
    </>
  )
}

/** Shown on every dashboard page while a site admin is signed in as someone else. */
function ImpersonationBar({ name, email, by, expiresAt }: { name: string; email: string; by: string; expiresAt: string }) {
  const [busy, setBusy] = useState(false)
  const stop = async () => {
    setBusy(true)
    const res = await fetch('/api/auth/admin/stop-impersonating', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    if (!res.ok) {
      setBusy(false)
      return toast('Couldn’t stop impersonating. Sign out to end it.')
    }
    window.location.href = '/admin/users'
  }
  return (
    <div className="imp-bar" role="status">
      <span>
        {by}, you’re signed in as {name} ({email}). Everything you do happens as them. Ends {new Date(expiresAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.
      </span>
      <button type="button" onClick={stop} disabled={busy}>
        {busy ? 'Stopping…' : 'Stop impersonating'}
      </button>
    </div>
  )
}

/* ------------------------------------------------ new workspace */
function NewWorkspace({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim().length < 2) return setErr('Give the workspace a name of at least 2 characters.')
    setBusy(true)
    const suffix = Math.random().toString(36).slice(2, 6)
    const { data, error } = await authClient.organization.create({ name: name.trim(), slug: `${slug || 'workspace'}-${suffix}` })
    if (error || !data) {
      setBusy(false)
      return setErr(authMessage(error, 'Couldn’t create the workspace.'))
    }
    await authClient.organization.setActive({ organizationId: data.id })
    toast(`Created ${data.name}`)
    onClose()
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="nw-title" onSubmit={submit} noValidate>
        <h2 id="nw-title">New workspace</h2>
        <p>Workspaces keep media, keys and teammates separate — one per client, brand or team works well.</p>
        <div className="dialog-body">
          <label className="field-d">
            <span>Name</span>
            <input
              className="input"
              value={name}
              autoFocus
              placeholder="e.g. Lumen Pictures"
              onChange={(e) => {
                setName(e.target.value)
                setErr('')
              }}
              aria-invalid={!!err}
            />
            {err ? <small className="is-bad">{err}</small> : <small>You’ll be its owner. You can rename it later.</small>}
          </label>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </form>
    </div>
  )
}
