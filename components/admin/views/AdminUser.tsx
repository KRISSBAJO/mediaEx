'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Icon from '../../app/Icon'
import { Card, PageHead, toast } from '../../app/ui'
import { AuditList, Back, Confirm, Loading, Pill, act, ago, day, useAdmin, when, type AuditEntry } from '../kit'

type Detail = {
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    role: string | null
    banned: boolean | null
    banReason: string | null
    banExpires: string | null
    createdAt: string
    signIn: string[]
    bootstrapAdmin: boolean
  }
  workspaces: { id: string; name: string; slug: string; role: string; members: number; assets: number; suspendedAt: string | null }[]
  sessions: { id: string; createdAt: string; updatedAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null; impersonatedBy: string | null }[]
  soleWorkspaces: { id: string; name: string }[]
  audit: AuditEntry[]
}
type Dialog = 'ban' | 'delete' | 'impersonate' | 'admin' | 'unadmin' | null

const device = (ua: string | null) =>
  !ua ? 'Unknown device' : `${/Mobile|iPhone|Android/.test(ua) ? 'Phone' : 'Computer'} · ${/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /node|undici/i.test(ua) ? 'Script' : 'Browser'}`

export default function AdminUser({ id }: { id: string }) {
  const router = useRouter()
  const { data, error, setData } = useAdmin<Detail>(`/api/admin/users/${id}`)
  const [dialog, setDialog] = useState<Dialog>(null)
  if (!data) return <Loading error={error} />
  const u = data.user
  const isAdmin = (u.role ?? '').split(',').includes('admin')
  const run = async (action: string, json?: unknown, done?: string) => {
    const r = await act<Detail>(`/api/admin/users/${id}/${action}`, { json, done })
    if (r && 'user' in r) setData({ ...data, ...r })
  }

  return (
    <>
      <Back href="/admin/users" label="Users" />
      <PageHead title={u.name} sub={u.email}>
        <div className="aactions">
          {!isAdmin && !u.banned && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog('impersonate')}>
              <Icon name="users" size={15} /> Impersonate
            </button>
          )}
          {u.banned ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => run('unban', {}, 'User restored — they can sign in again')}>
              Restore access
            </button>
          ) : (
            !isAdmin && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('ban')}>
                Suspend
              </button>
            )
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => run('revoke-sessions', {}, 'Signed out of every device')}>
            Sign out everywhere
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => run('reset-password', {}, `Password reset email sent to ${u.email}`)}>
            Send password reset
          </button>
          {!u.emailVerified && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => run('verify-email', {}, 'Email marked as verified')}>
              Mark email verified
            </button>
          )}
          {isAdmin ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('unadmin')} disabled={u.bootstrapAdmin}>
              Remove admin
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('admin')}>
              Make admin
            </button>
          )}
          {!isAdmin && (
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setDialog('delete')}>
              Delete
            </button>
          )}
        </div>
      </PageHead>

      {u.banned && (
        <div className="banner is-bad" role="status">
          <Icon name="alert" />
          <div>
            <b>Suspended.</b> {u.banReason ?? ''}
            <small>{u.banExpires ? `Until ${when(u.banExpires)}.` : 'Until an admin restores access.'} They can’t sign in, and were signed out everywhere.</small>
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="stack">
          <Card title="Workspaces" meta={`${data.workspaces.length}`} flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Workspace</th>
                    <th>Role</th>
                    <th className="num">Members</th>
                    <th className="num">Assets</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workspaces.map((w) => (
                    <tr key={w.id}>
                      <td>
                        <Link href={`/admin/workspaces/${w.id}`} className="cell-strong">
                          {w.name}
                        </Link>
                        {w.suspendedAt && <Pill tone="bad">Suspended</Pill>}
                      </td>
                      <td className="muted">{w.role}</td>
                      <td className="num">{w.members}</td>
                      <td className="num">{w.assets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Signed-in devices" meta={`${data.sessions.length} active`} flush>
            {data.sessions.length ? (
              <ul className="rows">
                {data.sessions.map((s) => (
                  <li key={s.id}>
                    <span>
                      <b>
                        {device(s.userAgent)}
                        {s.impersonatedBy && <Pill tone="warn">Impersonation</Pill>}
                      </b>
                      <small>
                        {s.ipAddress || 'No IP recorded'} · active {ago(s.updatedAt)} · expires {day(s.expiresAt)}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet-note acard-pad">Not signed in anywhere.</p>
            )}
          </Card>
        </div>
        <div className="stack">
          <Card title="Account">
            <dl className="details">
              <div>
                <dt>User ID</dt>
                <dd className="mono">{u.id}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className="apills">
                    {u.banned ? <Pill tone="bad">Suspended</Pill> : <Pill tone="good">Active</Pill>}
                    {isAdmin && <Pill tone="accent">Admin{u.bootstrapAdmin ? ' · from SITE_ADMIN_EMAILS' : ''}</Pill>}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>
                  {u.email} · {u.emailVerified ? 'verified' : 'not verified'}
                </dd>
              </div>
              <div>
                <dt>Signs in with</dt>
                <dd>{u.signIn.map((p) => (p === 'credential' ? 'Email and password' : p[0].toUpperCase() + p.slice(1))).join(', ') || '—'}</dd>
              </div>
              <div>
                <dt>Joined</dt>
                <dd>{when(u.createdAt)}</dd>
              </div>
            </dl>
          </Card>
          <Card title="Admin activity" meta="On this user" flush>
            <AuditList entries={data.audit} />
          </Card>
        </div>
      </div>

      {dialog === 'impersonate' && (
        <Confirm
          title={`Sign in as ${u.name}?`}
          body={
            <p>
              You’ll see MediaEX exactly as {u.email} does, and anything you do is done as them, for up to an hour. A banner shows the whole time, with a way back. This is
              recorded in the audit log.
            </p>
          }
          action="Impersonate"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const res = await fetch('/api/auth/admin/impersonate-user', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: id }) })
            if (!res.ok) {
              const b = await res.json().catch(() => ({}))
              toast(b.message ?? 'Couldn’t start impersonating.')
              return
            }
            window.location.href = '/dashboard'
          }}
        />
      )}
      {dialog === 'ban' && (
        <Confirm
          title={`Suspend ${u.name}?`}
          body={<p>They’re signed out everywhere straight away and can’t sign in until you restore access. Their workspaces keep running for other members.</p>}
          reason="Reason (shown to them when they try to sign in, and kept in the audit log)"
          action="Suspend user"
          danger
          onClose={() => setDialog(null)}
          onConfirm={(reason) => run('ban', { reason }, 'User suspended and signed out')}
        />
      )}
      {(dialog === 'admin' || dialog === 'unadmin') && (
        <Confirm
          title={dialog === 'admin' ? `Make ${u.name} a site admin?` : `Remove ${u.name}’s admin role?`}
          body={
            <p>
              {dialog === 'admin'
                ? 'Site admins can see every account and workspace, suspend and delete them, take media down and impersonate users.'
                : 'They keep their account and workspaces, and lose access to the site admin area.'}
            </p>
          }
          action={dialog === 'admin' ? 'Make admin' : 'Remove admin'}
          danger={dialog === 'admin'}
          onClose={() => setDialog(null)}
          onConfirm={() => run('role', { role: dialog === 'admin' ? 'admin' : 'user' }, dialog === 'admin' ? 'They’re a site admin now' : 'Admin role removed')}
        />
      )}
      {dialog === 'delete' && (
        <Confirm
          title={`Delete ${u.name}?`}
          body={
            <>
              <p>This deletes the account and can’t be undone.</p>
              {data.soleWorkspaces.length > 0 ? (
                <p>
                  They’re the only member of <b>{data.soleWorkspaces.map((w) => w.name).join(', ')}</b>, so {data.soleWorkspaces.length === 1 ? 'that workspace' : 'those workspaces'} and
                  all {data.soleWorkspaces.length === 1 ? 'its' : 'their'} media are deleted too.
                </p>
              ) : (
                <p>Workspaces they share with others keep running without them.</p>
              )}
            </>
          }
          action="Delete user"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (await act(`/api/admin/users/${id}`, { method: 'DELETE', done: 'User deleted' })) router.push('/admin/users')
          }}
        />
      )}
    </>
  )
}
