'use client'

/** Small shared pieces for the site admin pages: data loading, actions, formatting, status pills, paging. */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from '../app/ui'

export async function adminFetch<T>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init?.json !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
    cache: 'no-store',
  })
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string; message?: string }).error ?? (body as { message?: string }).message ?? `Request failed (${res.status})`)
  return body as T
}

/** GET a path, refetch when it changes; `reload` to refresh after an action. */
export function useAdmin<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!path) return
    let live = true
    setError('')
    adminFetch<T>(path)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [path, n])
  const reload = useCallback(() => setN((x) => x + 1), [])
  return { data, error, reload, setData }
}

/** Runs an admin action with a toast either way; resolves to the response, or null on failure. */
export async function act<T = unknown>(path: string, opts: { method?: string; json?: unknown; done?: string } = {}): Promise<T | null> {
  try {
    const r = await adminFetch<T>(path, { method: opts.method ?? 'POST', json: opts.json ?? (opts.method === 'DELETE' ? undefined : {}) })
    if (opts.done) toast(opts.done)
    return r ?? ({} as T)
  } catch (e) {
    toast(e instanceof Error ? e.message : 'That didn’t work.')
    return null
  }
}

export const fmtBytes = (n: number) => {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1000)))
  return `${(n / 1000 ** i).toFixed(i ? (n / 1000 ** i < 10 ? 1 : 0) : 0)} ${u[i]}`
}
export const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n)
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
export function ago(iso: string | null | undefined) {
  if (!iso) return 'never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`
  return day(iso)
}

/** A small status pill: good, warn, bad or plain. */
export function Pill({ tone, children }: { tone?: 'good' | 'warn' | 'bad' | 'accent'; children: React.ReactNode }) {
  return <span className={`apill ${tone ? `is-${tone}` : ''}`}>{children}</span>
}

export function PlanPill({ plan, override }: { plan: string; override?: boolean }) {
  return (
    <Pill tone={plan === 'creator' ? undefined : 'accent'}>
      {plan[0].toUpperCase() + plan.slice(1)}
      {override ? ' · override' : ''}
    </Pill>
  )
}

export function Pager({ total, limit, offset, onPage }: { total: number; limit: number; offset: number; onPage: (offset: number) => void }) {
  if (total <= limit) return null
  return (
    <div className="apager">
      <span>
        {offset + 1}–{Math.min(total, offset + limit)} of {total.toLocaleString('en-US')}
      </span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>
        Previous
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={offset + limit >= total} onClick={() => onPage(offset + limit)}>
        Next
      </button>
    </div>
  )
}

export function Loading({ error }: { error?: string }) {
  return error ? (
    <div className="banner is-bad" role="alert">
      <div>
        <b>Couldn’t load this.</b> {error}
      </div>
    </div>
  ) : (
    <p className="quiet-note">Loading…</p>
  )
}

/** A confirm step for anything destructive: what happens, an optional reason, and the button. */
export function Confirm({
  title,
  body,
  action,
  danger,
  reason,
  onClose,
  onConfirm,
}: {
  title: string
  body: React.ReactNode
  action: string
  danger?: boolean
  reason?: string
  onClose: () => void
  onConfirm: (reason: string) => Promise<unknown>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          await onConfirm(text.trim())
          setBusy(false)
          onClose()
        }}
      >
        <h2 id="confirm-title">{title}</h2>
        <div className="aconfirm-body">{body}</div>
        {reason && (
          <label className="field-d">
            <span>{reason}</span>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} autoFocus />
          </label>
        )}
        <div className="dialog-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
            {busy ? 'Working…' : action}
          </button>
        </div>
      </form>
    </div>
  )
}

/** The audit trail for one thing, used on user and workspace pages. */
export type AuditEntry = { id: string; adminEmail: string | null; action: string; targetType: string; targetId: string | null; details: Record<string, unknown>; createdAt: string }
export const ACTION_LABEL: Record<string, string> = {
  'user.suspend': 'Suspended user',
  'user.restore': 'Restored user',
  'user.delete': 'Deleted user',
  'user.sign-out-everywhere': 'Signed user out everywhere',
  'user.verify-email': 'Marked email verified',
  'user.send-password-reset': 'Sent password reset',
  'user.impersonate.start': 'Started impersonating',
  'user.impersonate.stop': 'Stopped impersonating',
  'admin.add': 'Made admin',
  'admin.remove': 'Removed admin',
  'workspace.suspend': 'Suspended workspace',
  'workspace.restore': 'Restored workspace',
  'workspace.delete': 'Deleted workspace',
  'workspace.plan-override': 'Set plan override',
  'workspace.plan-override-remove': 'Removed plan override',
  'workspace.note': 'Updated note',
  'asset.takedown': 'Took down asset',
  'asset.restore': 'Restored asset',
  'asset.retry': 'Re-ran pipeline',
  'asset.delete': 'Deleted asset',
  'ops.retry-failed': 'Retried failed jobs',
}
export const targetHref = (t: string, id: string | null) =>
  !id ? null : t === 'user' ? `/admin/users/${id}` : t === 'workspace' ? `/admin/workspaces/${id}` : t === 'asset' ? `/admin/media?q=${id}` : null

export function AuditList({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <p className="quiet-note acard-pad">No admin actions yet.</p>
  return (
    <ul className="rows">
      {entries.map((e) => {
        const reason = typeof e.details?.reason === 'string' ? e.details.reason : null
        return (
          <li key={e.id}>
            <span>
              <b>{ACTION_LABEL[e.action] ?? e.action}</b>
              <small>
                {e.adminEmail ?? 'An admin'} · {when(e.createdAt)}
                {reason ? ` · “${reason}”` : ''}
              </small>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export function Back({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="back-link">
      ← {label}
    </Link>
  )
}
