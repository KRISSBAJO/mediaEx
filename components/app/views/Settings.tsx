'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { authClient, authMessage } from '@/lib/auth-client'
import { bytes } from '@/lib/sample'
import type { BillingInterval, BillingState, PlanId } from '@/lib/media/types'
import { request } from '../library'
import { canManage, useAccount, type Role } from '../account'
import Icon from '../Icon'
import { Avatar, Card, LoadFailed, Meter, PageHead, toast } from '../ui'
import SettingsMetadata from './SettingsMetadata'
import SettingsModeration from './SettingsModeration'
import SettingsEncoding from './SettingsEncoding'

type Tab = 'general' | 'team' | 'metadata' | 'moderation' | 'encoding' | 'account' | 'billing'
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
    if (error) return setErr(error.code?.includes('SLUG') ? 'That workspace slug is already taken. Try another.' : authMessage(error, 'Couldn’t save the workspace.'))
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
      <Card
        title="Workspace"
        hint={!manage ? 'Only owners and admins can change these.' : err ? <span className="is-bad">{err}</span> : 'Changes apply for everyone in the workspace.'}
        footer={
          manage && (
            <>
              {dirty && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => (setName(workspace.name), setSlug(workspace.slug), setErr(''))}>
                  Discard
                </button>
              )}
              <button type="submit" form="ws-form" className="btn btn-primary btn-sm" disabled={!dirty || !slugOk || !name.trim() || saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )
        }
      >
        <p className="setting-desc">Your team sees the workspace name in the switcher and on invitations. The slug uniquely identifies the workspace.</p>
        <form id="ws-form" onSubmit={save} noValidate>
          <label className="setting-field">
            <span>Name</span>
            <input className="input" value={name} disabled={!manage} onChange={(e) => (setName(e.target.value), setErr(''))} />
          </label>
          <label className="setting-field">
            <span>Workspace slug</span>
            <input
              className="input"
              value={slug}
              disabled={!manage}
              onChange={(e) => (setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')), setErr(''))}
              aria-invalid={!slugOk}
            />
            {!slugOk && <small className="is-bad">Use 2–48 lowercase letters, numbers or dashes.</small>}
          </label>
        </form>
      </Card>

      {workspace.role === 'owner' && (
        <Card
          title="Delete workspace"
          className="danger"
          hint="This can’t be undone."
          footer={
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleting(true)}>
              Delete workspace
            </button>
          }
        >
          <p className="setting-desc">Permanently removes {workspace.name}, its members and pending invitations.</p>
        </Card>
      )}

      {deleting && (
        <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && setDeleting(false)}>
          <form className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="ws-del" onSubmit={remove}>
            <h2 id="ws-del">Delete {workspace.name}?</h2>
            <p>
              Type <b>{workspace.slug}</b> to confirm. The workspace, its members and invitations are removed permanently.
            </p>
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus aria-label="Workspace slug to confirm" />
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
        <Card
          title="Invite people"
          hint={err ? <span className="is-bad">{err}</span> : `${ROLE_LABEL[role]}s: ${ROLE_HELP[role].toLowerCase()}.`}
          footer={
            <button type="submit" form="invite-form" className="btn btn-primary btn-sm" disabled={sending}>
              {sending ? 'Sending…' : 'Send invite'}
            </button>
          }
        >
          <p className="setting-desc">They get an email with a link to join {workspace.name}. Invitations expire after 7 days.</p>
          <form id="invite-form" className="invite" noValidate onSubmit={invite}>
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
          </form>
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
                  <th className="actions">
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
                      <td className="actions">
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
      <Card
        title="Profile"
        hint={user.emailVerified ? 'Email verified.' : 'Email not verified yet — check your inbox for the link.'}
        footer={
          <button type="submit" form="name-form" className="btn btn-primary btn-sm" disabled={savingName || !name.trim() || name.trim() === user.name}>
            {savingName ? 'Saving…' : 'Save'}
          </button>
        }
      >
        <p className="setting-desc">How you appear to your team in workspaces, comments and invitations.</p>
        <form id="name-form" onSubmit={saveName}>
          <label className="setting-field">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="setting-field">
            <span>Email</span>
            <input className="input" value={user.email} disabled />
          </label>
        </form>
      </Card>
      <Card
        title="Password"
        hint={pwErr ? <span className="is-bad">{pwErr}</span> : 'At least 8 characters. Changing it signs out your other devices.'}
        footer={
          <button type="submit" form="pw-form" className="btn btn-primary btn-sm" disabled={savingPw || !current || !next}>
            {savingPw ? 'Changing…' : 'Change password'}
          </button>
        }
      >
        <form id="pw-form" onSubmit={savePw} noValidate>
          <label className="setting-field">
            <span>Current password</span>
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => (setCurrent(e.target.value), setPwErr(''))} />
          </label>
          <label className="setting-field">
            <span>New password</span>
            <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => (setNext(e.target.value), setPwErr(''))} />
          </label>
        </form>
      </Card>
    </div>
  )
}

/* ------------------------------------------------ billing */
const PLAN_BLURB: Record<PlanId, string> = {
  creator: '100 GB storage, 1080p streaming, 50 processing minutes a month.',
  pro: '2 TB storage, 4K streaming, 1,000 processing minutes a month, HEVC and AV1.',
  studio: '10 TB storage then pay as you go, 8K streaming, unlimited processing, HEVC and AV1.',
}
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount)
// billing periods are UTC days
const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

function Billing() {
  const { workspace } = useAccount()
  const manage = canManage(workspace.role)
  const params = useSearchParams()
  const [b, setB] = useState<BillingState | null>(null)
  const [interval, setInterval_] = useState<BillingInterval>('year')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [failed, setFailed] = useState('')
  const load = useCallback(() => {
    request<BillingState>('/api/billing')
      .then((x) => (setFailed(''), setB(x)))
      .catch((e) => setFailed(e instanceof Error ? e.message : 'Couldn’t load billing.'))
  }, [])
  useEffect(load, [load])
  // back from checkout: the provider's webhook may land a moment later
  useEffect(() => {
    if (params.get('checkout') !== 'done') return
    toast('Payment received — your plan updates in a moment')
    const t = setTimeout(load, 4000)
    return () => clearTimeout(t)
  }, [params, load])

  if (failed && !b) return <LoadFailed what="billing" detail={failed} onRetry={load} />
  if (!b) return <p className="quiet-note">Loading…</p>
  const go = async (path: string, json?: unknown) => {
    setBusy(path)
    try {
      const { url } = await request<{ url: string }>(`/api/billing/${path}`, { method: 'POST', json: json ?? {} })
      window.location.href = url
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t reach billing.')
      setBusy(null)
    }
  }
  const price = (plan: PlanId) => b.prices.find((p) => p.plan === plan && p.interval === interval)
  const u = b.usage
  const paid = b.plan !== 'creator'

  return (
    <div className="stack">
      {!b.provider && (
        <div className="banner" role="note">
          <Icon name="card" />
          <div>
            <b>Billing isn’t set up on this server.</b> Every workspace is on Creator until a payment provider is configured (STRIPE_SECRET_KEY or PAYSTACK_SECRET_KEY on the
            backend).
          </div>
        </div>
      )}
      {b.status === 'past_due' && (
        <div className="banner is-bad" role="alert">
          <Icon name="alert" />
          <div>
            <b>The last payment didn’t go through.</b> Update your card within 7 days to keep {b.planName}.
          </div>
          {b.manageable && manage && (
            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => go('portal')}>
              Update card
            </button>
          )}
        </div>
      )}

      <Card
        title="Plan"
        footer={
          <div className="bill-foot">
            <Link href="/pricing" className="btn btn-ghost btn-sm">
              Compare plans
            </Link>
            {paid && b.manageable && manage && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => go('portal')}>
                  {busy === 'portal' ? 'Opening…' : 'Manage billing'}
                </button>
                {!b.cancelAtPeriodEnd && (
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirmCancel(true)}>
                    Cancel plan
                  </button>
                )}
              </>
            )}
          </div>
        }
      >
        <div className="plan-now">
          <div>
            <span className="plan-name">{b.planName}</span>
            <p className="access-note">{PLAN_BLURB[b.plan]}</p>
          </div>
          <div className="plan-cost">
            {paid && b.interval ? (
              <>
                <strong>{(() => {
                  const p = b.prices.find((x) => x.plan === b.plan && x.interval === b.interval)
                  return p ? money(p.amount, p.currency) : '—'
                })()}</strong>
                <span>/ {b.interval}</span>
              </>
            ) : (
              <>
                <strong>$0</strong>
                <span>/ month</span>
              </>
            )}
          </div>
        </div>
        {paid && b.currentPeriodEnd && (
          <p className="access-note bill-when">
            {b.cancelAtPeriodEnd ? `Cancelled — ${b.planName} stays on until ${dateOf(b.currentPeriodEnd)}, then the workspace moves to Creator.` : `Renews on ${dateOf(b.currentPeriodEnd)}.`}
          </p>
        )}
      </Card>

      {b.provider && (!paid || b.cancelAtPeriodEnd) && (
        <Card
          title={paid ? 'Choose a plan' : 'Upgrade'}
          meta={b.provider === 'stripe' ? 'Card payments by Stripe' : 'Card and bank payments by Paystack'}
          action={
            <div className="seg seg-sm" role="group" aria-label="Billing period">
              {(['month', 'year'] as const).map((iv) => (
                <button key={iv} type="button" aria-pressed={interval === iv} className={interval === iv ? 'is-on' : ''} onClick={() => setInterval_(iv)}>
                  {iv === 'month' ? 'Monthly' : 'Yearly'}
                </button>
              ))}
            </div>
          }
        >
          <div className="bill-plans">
            {(['pro', 'studio'] as const).map((plan) => {
              const p = price(plan)
              return (
                <div key={plan} className={`bill-plan ${plan === 'pro' ? 'is-featured' : ''}`}>
                  <b>{plan === 'pro' ? 'Pro' : 'Studio'}</b>
                  <div className="plan-cost">
                    <strong>{p ? money(p.amount, p.currency) : '—'}</strong>
                    <span>/ {interval}</span>
                  </div>
                  <p className="access-note">{PLAN_BLURB[plan]}</p>
                  <button type="button" className={`btn btn-sm ${plan === 'pro' ? 'btn-primary' : 'btn-ghost'}`} disabled={!manage || !p || !!busy} onClick={() => go('checkout', { plan, interval })}>
                    {busy === 'checkout' ? 'Opening checkout…' : `Choose ${plan === 'pro' ? 'Pro' : 'Studio'}`}
                  </button>
                </div>
              )
            })}
          </div>
          {!manage && <p className="access-note">Only owners and admins can change the plan.</p>}
        </Card>
      )}

      <Card title="Usage this period" meta={`${dateOf(u.periodStart)} – ${dateOf(new Date(new Date(u.periodEnd).getTime() - 86400000).toISOString())}`}>
        <ul className="usage-grid">
          <li>
            <div className="usage-row">
              <span>Storage</span>
              <b>
                {bytes(u.storageBytes)} / {bytes(u.storageLimit)}
                {b.plan === 'studio' ? ' included' : ''}
              </b>
            </div>
            <Meter value={u.storageBytes} max={u.storageLimit} tone={u.storageBytes > u.storageLimit * 0.9 ? 'warn' : undefined} />
            {u.storageOverage > 0 && <small className="access-note">{bytes(u.storageOverage)} over the included storage, billed as you go.</small>}
          </li>
          <li>
            <div className="usage-row">
              <span>Processing minutes</span>
              <b>
                {Math.round(u.minutes).toLocaleString('en-US')} / {u.minutesLimit === null ? 'Unlimited' : u.minutesLimit.toLocaleString('en-US')}
              </b>
            </div>
            <Meter value={u.minutes} max={u.minutesLimit ?? Math.max(u.minutes, 1) * 4} tone={u.minutesLimit !== null && u.minutes >= u.minutesLimit * 0.9 ? 'warn' : undefined} />
          </li>
        </ul>
        <p className="access-note bill-when">Minutes count the length of each video and audio file processed this period. Delivery, the player and the API are included on every plan.</p>
      </Card>

      {confirmCancel && (
        <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && setConfirmCancel(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-title">
            <h2 id="cancel-title">Cancel {b.planName}?</h2>
            <p>
              Nothing changes until {b.currentPeriodEnd ? dateOf(b.currentPeriodEnd) : 'the end of the period'}. After that the workspace moves to Creator: uploads stop once
              storage is over 100 GB, and new videos encode up to 1080p.
            </p>
            <div className="dialog-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmCancel(false)} autoFocus>
                Keep {b.planName}
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={!!busy}
                onClick={async () => {
                  setBusy('cancel')
                  try {
                    setB(await request<BillingState>('/api/billing/cancel', { method: 'POST', json: {} }))
                    toast(`Cancelled — ${b.planName} stays on until the period ends`)
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Couldn’t cancel.')
                  } finally {
                    setBusy(null)
                    setConfirmCancel(false)
                  }
                }}
              >
                Cancel plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const SECTIONS: { value: Tab; label: string; icon: string }[] = [
  { value: 'general', label: 'Workspace', icon: 'layers' },
  { value: 'team', label: 'Team', icon: 'users' },
  { value: 'metadata', label: 'Metadata', icon: 'list' },
  { value: 'moderation', label: 'Moderation', icon: 'check' },
  { value: 'encoding', label: 'Encoding', icon: 'layers' },
  { value: 'account', label: 'Account', icon: 'settings' },
  { value: 'billing', label: 'Billing', icon: 'card' },
]

export default function Settings() {
  const params = useSearchParams()
  const router = useRouter()
  const { workspace } = useAccount()
  const raw = params.get('tab')
  const tab: Tab = raw === 'team' || raw === 'billing' || raw === 'account' || raw === 'metadata' || raw === 'moderation' || raw === 'encoding' ? raw : 'general'

  return (
    <>
      <PageHead title="Settings" sub={`${workspace.name} · you are ${workspace.role === 'admin' || workspace.role === 'owner' ? 'an' : 'a'} ${ROLE_LABEL[workspace.role].toLowerCase()}`} />
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((x) => (
            <button
              key={x.value}
              type="button"
              aria-current={tab === x.value ? 'page' : undefined}
              onClick={() => router.replace(x.value === 'general' ? '/dashboard/settings' : `/dashboard/settings?tab=${x.value}`, { scroll: false })}
            >
              <Icon name={x.icon} size={16} />
              {x.label}
            </button>
          ))}
        </nav>
        <div>
          {tab === 'general' && <General />}
          {tab === 'team' && <Team />}
          {tab === 'account' && <Account />}
          {tab === 'metadata' && <SettingsMetadata />}
          {tab === 'moderation' && <SettingsModeration />}
          {tab === 'encoding' && <SettingsEncoding />}
          {tab === 'billing' && <Billing />}
        </div>
      </div>
    </>
  )
}
