'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { authClient, authMessage } from '@/lib/auth-client'
import { USAGE } from '@/lib/sample'
import { canManage, useAccount, type Role } from '../account'
import Icon from '../Icon'
import { Avatar, Card, Meter, PageHead, Tabs, toast } from '../ui'

type Tab = 'general' | 'team' | 'account' | 'billing'
const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }
const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including deleting the workspace',
  admin: 'Manage members, settings and keys',
  member: 'Upload, edit and share media',
}
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?'

/* ------------------------------------------------ general: the workspace itself */
function General() {
  const router = useRouter()
  const { workspace, workspaces } = useAccount()
  const manage = canManage(workspace.role)
  const [name, setName] = useState(workspace.name)
  const [slug, setSlug] = useState(workspace.slug)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [busyDelete, setBusyDelete] = useState(false)
  const dirty = name.trim() !== workspace.name || slug !== workspace.slug
  const slugOk = /^[a-z0-9][a-z0-9-]{1,47}$/.test(slug)

  useEffect(() => {
    setName(workspace.name)
    setSlug(workspace.slug)
  }, [workspace.name, workspace.slug])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !slugOk) return
    setSaving(true)
    setErr('')
    const { error } = await authClient.organization.update({ organizationId: workspace.id, data: { name: name.trim(), slug } })
    setSaving(false)
    if (error) return setErr(error.code?.includes('SLUG') ? 'That URL is already taken. Try another.' : authMessage(error, 'Couldn’t save the workspace.'))
    toast('Workspace saved')
    router.refresh()
  }

  const remove = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusyDelete(true)
    const { error } = await authClient.organization.delete({ organizationId: workspace.id })
    if (error) {
      setBusyDelete(false)
      return toast(authMessage(error, 'Couldn’t delete the workspace.'))
    }
    const other = workspaces.find((w) => w.id !== workspace.id)
    if (other) await authClient.organization.setActive({ organizationId: other.id })
    toast(`Deleted ${workspace.name}`)
    router.replace('/dashboard')
    router.refresh()
  }

  return (
    <div className="stack">
      <Card title="Workspace" meta={manage ? undefined : 'Only owners and admins can change these'}>
        <form className="form-stack narrow" onSubmit={save} noValidate>
          <label className="field-d">
            <span>Name</span>
            <input className="input" value={name} disabled={!manage} onChange={(e) => (setName(e.target.value), setErr(''))} />
          </label>
          <label className="field-d">
            <span>URL</span>
            <div className="input-prefix">
              <em>mediaex.io/</em>
              <input
                className="input"
                value={slug}
                disabled={!manage}
                onChange={(e) => (setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')), setErr(''))}
                aria-invalid={!slugOk}
              />
            </div>
            {!slugOk ? <small className="is-bad">Use 2–48 lowercase letters, numbers or dashes.</small> : err ? <small className="is-bad">{err}</small> : <small>Review links and the public player will use this address.</small>}
          </label>
          {manage && (
            <div className="form-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={!dirty || !slugOk || !name.trim() || saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {dirty && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => (setName(workspace.name), setSlug(workspace.slug), setErr(''))}>
                  Discard
                </button>
              )}
            </div>
          )}
        </form>
      </Card>

      {workspace.role === 'owner' && (
        <Card title="Danger zone" className="danger">
          <div className="danger-row">
            <div>
              <b>Delete this workspace</b>
              <p>Removes the workspace, its members and pending invitations. This can’t be undone.</p>
            </div>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleting(true)}>
              Delete workspace
            </button>
          </div>
        </Card>
      )}

      {deleting && (
        <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && setDeleting(false)}>
          <form className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="ws-del" onSubmit={remove}>
            <h2 id="ws-del">Delete {workspace.name}?</h2>
            <p>
              Type <b>{workspace.slug}</b> to confirm. The workspace, its members and invitations are removed permanently.
            </p>
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus aria-label="Workspace URL to confirm" />
            <div className="dialog-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-danger btn-sm" disabled={confirm !== workspace.slug || busyDelete}>
                {busyDelete ? 'Deleting…' : 'Delete workspace'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------ team: members + invitations */
type Member = { id: string; role: string; userId: string; createdAt: Date | string; user: { name: string; email: string } }
type Invite = { id: string; email: string; role: string; status: string; expiresAt: Date | string }

function Team() {
  const { user, workspace } = useAccount()
  const manage = canManage(workspace.role)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [loadErr, setLoadErr] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await authClient.organization.getFullOrganization({ query: { organizationId: workspace.id } })
    if (error || !data) return setLoadErr(authMessage(error, 'Couldn’t load the team.'))
    setMembers(data.members as Member[])
    setInvites((data.invitations as Invite[]).filter((i) => i.status === 'pending'))
  }, [workspace.id])

  useEffect(() => {
    load()
  }, [load])

  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setErr('Enter a valid email address.')
    setSending(true)
    const { error } = await authClient.organization.inviteMember({ email: v, role, organizationId: workspace.id })
    setSending(false)
    if (error) return setErr(authMessage(error, 'Couldn’t send the invitation.'))
    setEmail('')
    setErr('')
    toast(`Invitation sent to ${v}`)
    load()
  }

  const changeRole = async (m: Member, r: Role) => {
    const { error } = await authClient.organization.updateMemberRole({ memberId: m.id, role: r, organizationId: workspace.id })
    if (error) return toast(authMessage(error, 'Couldn’t change the role.'))
    toast(`${m.user.name} is now ${r === 'admin' || r === 'owner' ? 'an' : 'a'} ${ROLE_LABEL[r].toLowerCase()}`)
    load()
  }
  const remove = async (m: Member) => {
    const { error } = await authClient.organization.removeMember({ memberIdOrEmail: m.id, organizationId: workspace.id })
    if (error) return toast(authMessage(error, 'Couldn’t remove the member.'))
    toast(`Removed ${m.user.name}`)
    load()
  }
  const cancel = async (i: Invite) => {
    const { error } = await authClient.organization.cancelInvitation({ invitationId: i.id })
    if (error) return toast(authMessage(error, 'Couldn’t cancel the invitation.'))
    toast(`Cancelled the invitation to ${i.email}`)
    load()
  }

  return (
    <div className="stack">
      {manage && (
        <Card title="Invite people" meta="They get an email with a link to join">
          <form className="invite" noValidate onSubmit={invite}>
            <input
              className="input grow"
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => (setEmail(e.target.value), setErr(''))}
              aria-label="Email address"
              aria-invalid={!!err}
            />
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit" className="btn btn-primary btn-sm" disabled={sending}>
              {sending ? 'Sending…' : 'Send invite'}
            </button>
          </form>
          {err ? <small className="is-bad form-err">{err}</small> : <small className="form-hint">{ROLE_HELP[role]}.</small>}
        </Card>
      )}

      <Card title="Members" meta={members ? `${members.length} ${members.length === 1 ? 'person' : 'people'}` : 'Loading…'} flush>
        {loadErr ? (
          <div className="empty">
            <Icon name="alert" size={22} />
            <b>{loadErr}</b>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setLoadErr(''), load())}>
              Try again
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th className="num">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(members ?? []).map((m) => {
                  const r = m.role.split(',')[0] as Role
                  const self = m.userId === user.id
                  return (
                    <tr key={m.id}>
                      <td>
                        <div className="member">
                          <Avatar initials={initials(m.user.name)} size={30} />
                          <span>
                            <b>
                              {m.user.name}
                              {self && <span className="chip">you</span>}
                            </b>
                            <small>{m.user.email}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        {manage && !self && r !== 'owner' ? (
                          <select className="select select-sm" value={r} aria-label={`Role for ${m.user.name}`} onChange={(e) => changeRole(m, e.target.value as Role)}>
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : (
                          <span className="muted">{ROLE_LABEL[r] ?? r}</span>
                        )}
                      </td>
                      <td className="muted">{new Date(m.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td className="num">
                        {manage && !self && r !== 'owner' && (
                          <button type="button" className="btn btn-quiet btn-sm" onClick={() => remove(m)}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {members === null && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Loading members…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {invites.length > 0 && (
        <Card title="Pending invitations" meta={`${invites.length} waiting`} flush>
          <ul className="rows">
            {invites.map((i) => (
              <li key={i.id}>
                <span className="file-kind">
                  <Icon name="users" size={16} />
                </span>
                <div>
                  <b>{i.email}</b>
                  <small>
                    {ROLE_LABEL[i.role as Role] ?? i.role} · expires {new Date(i.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </small>
                </div>
                {manage && (
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => cancel(i)}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

/* ------------------------------------------------ account: the signed-in person */
function Account() {
  const router = useRouter()
  const { user } = useAccount()
  const [name, setName] = useState(user.name)
  const [savingName, setSavingName] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSavingName(true)
    const { error } = await authClient.updateUser({ name: name.trim() })
    setSavingName(false)
    if (error) return toast(authMessage(error, 'Couldn’t save your name.'))
    toast('Name updated')
    router.refresh()
  }
  const savePw = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next.length < 8) return setPwErr('Use at least 8 characters.')
    setSavingPw(true)
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true })
    setSavingPw(false)
    if (error) return setPwErr(error.code === 'INVALID_PASSWORD' ? 'Your current password is wrong.' : authMessage(error, 'Couldn’t change the password.'))
    setCurrent('')
    setNext('')
    setPwErr('')
    toast('Password changed. Other devices were signed out.')
  }

  return (
    <div className="stack">
      <Card title="Profile">
        <form className="form-stack narrow" onSubmit={saveName}>
          <label className="field-d">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="field-d">
            <span>Email</span>
            <input className="input" value={user.email} disabled />
            <small>{user.emailVerified ? 'Verified.' : 'Not verified yet — check your inbox for the link.'}</small>
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={savingName || !name.trim() || name.trim() === user.name}>
            {savingName ? 'Saving…' : 'Save name'}
          </button>
        </form>
      </Card>
      <Card title="Password">
        <form className="form-stack narrow" onSubmit={savePw} noValidate>
          <label className="field-d">
            <span>Current password</span>
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => (setCurrent(e.target.value), setPwErr(''))} />
          </label>
          <label className="field-d">
            <span>New password</span>
            <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => (setNext(e.target.value), setPwErr(''))} />
            {pwErr ? <small className="is-bad">{pwErr}</small> : <small>At least 8 characters. Changing it signs out your other devices.</small>}
          </label>
          <button type="submit" className="btn btn-ghost btn-sm" disabled={savingPw || !current || !next}>
            {savingPw ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </Card>
    </div>
  )
}

/* ------------------------------------------------ billing (not connected yet) */
function Billing() {
  const rows = [
    { label: 'Storage', ...USAGE.storage },
    { label: 'Transcode minutes', ...USAGE.transcode },
    { label: 'Bandwidth', ...USAGE.bandwidth },
    { label: 'Caption hours', ...USAGE.captions },
  ]
  return (
    <div className="stack">
      <div className="banner" role="note">
        <Icon name="card" />
        <div>
          <b>Billing isn’t connected yet.</b> Every workspace is on the free plan for now. The usage below is sample data.
        </div>
      </div>
      <div className="grid-2">
        <Card title="Usage this cycle" meta="Sample data">
          <ul className="usage-list">
            {rows.map((r) => (
              <li key={r.label}>
                <div className="usage-row">
                  <span>{r.label}</span>
                  <b>
                    {r.used.toLocaleString('en-US')} / {r.limit.toLocaleString('en-US')} {r.unit}
                  </b>
                </div>
                <Meter value={r.used} max={r.limit} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Plan">
          <div className="plan-now">
            <span className="plan-name">Free</span>
            <div className="plan-cost">
              <strong>$0</strong>
              <span>/ month</span>
            </div>
            <p>Paid plans unlock once billing is connected. Compare plans on the pricing page.</p>
            <div className="form-actions">
              <Link href="/#pricing" className="btn btn-ghost btn-sm">
                See plans
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default function Settings() {
  const params = useSearchParams()
  const router = useRouter()
  const { workspace } = useAccount()
  const raw = params.get('tab')
  const tab: Tab = raw === 'team' || raw === 'billing' || raw === 'account' ? raw : 'general'

  return (
    <>
      <PageHead title="Settings" sub={`${workspace.name} · you are ${workspace.role === 'admin' || workspace.role === 'owner' ? 'an' : 'a'} ${ROLE_LABEL[workspace.role].toLowerCase()}`} />
      <Tabs
        value={tab}
        onChange={(t) => router.replace(t === 'general' ? '/dashboard/settings' : `/dashboard/settings?tab=${t}`, { scroll: false })}
        tabs={[
          { value: 'general', label: 'Workspace' },
          { value: 'team', label: 'Team' },
          { value: 'account', label: 'Account' },
          { value: 'billing', label: 'Billing' },
        ]}
      />
      {tab === 'general' && <General />}
      {tab === 'team' && <Team />}
      {tab === 'account' && <Account />}
      {tab === 'billing' && <Billing />}
    </>
  )
}
