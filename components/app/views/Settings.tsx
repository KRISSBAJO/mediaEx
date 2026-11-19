'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { MEMBERS, USAGE, WORKSPACE } from '@/lib/sample'
import Icon from '../Icon'
import { Avatar, Card, Meter, PageHead, Tabs, toast } from '../ui'

type Tab = 'general' | 'team' | 'billing'
const ROLES = ['Owner', 'Admin', 'Editor', 'Developer', 'Reviewer']

function General() {
  const [name, setName] = useState(WORKSPACE.name)
  const [slug, setSlug] = useState(WORKSPACE.slug)
  const [tz, setTz] = useState('Africa/Lagos')
  const [saved, setSaved] = useState({ name: WORKSPACE.name, slug: WORKSPACE.slug, tz: 'Africa/Lagos' })
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const dirty = name !== saved.name || slug !== saved.slug || tz !== saved.tz
  const slugOk = /^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)

  return (
    <div className="stack">
      <Card title="Workspace">
        <form
          className="form-stack narrow"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim() || !slugOk) return
            setSaved({ name, slug, tz })
            toast('Workspace settings saved for this session')
          }}
        >
          <label className="field-d">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field-d">
            <span>URL</span>
            <div className="input-prefix">
              <em>mediaex.io/</em>
              <input className="input" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} aria-invalid={!slugOk} />
            </div>
            {slugOk ? <small>Review links and the public player use this address.</small> : <small className="is-bad">Use 2–31 lowercase letters, numbers or dashes.</small>}
          </label>
          <label className="field-d">
            <span>Time zone for reports</span>
            <select className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
              <option value="Africa/Lagos">Lagos (GMT+1)</option>
              <option value="Europe/London">London (GMT)</option>
              <option value="Europe/Paris">Paris (GMT+1)</option>
              <option value="America/New_York">New York (GMT−5)</option>
              <option value="America/Los_Angeles">Los Angeles (GMT−8)</option>
            </select>
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={!dirty || !slugOk || !name.trim()}>
              Save changes
            </button>
            {dirty && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => (setName(saved.name), setSlug(saved.slug), setTz(saved.tz))}>
                Discard
              </button>
            )}
          </div>
        </form>
      </Card>

      <Card title="Danger zone" className="danger">
        <div className="danger-row">
          <div>
            <b>Delete this workspace</b>
            <p>Removes every asset, rendition, key and member. Embeds stop playing. This can’t be undone.</p>
          </div>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleting(true)}>
            Delete workspace
          </button>
        </div>
      </Card>

      {deleting && (
        <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && setDeleting(false)}>
          <form
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ws-del"
            onSubmit={(e) => {
              e.preventDefault()
              setDeleting(false)
              setConfirm('')
              toast('Sample workspace — nothing was deleted')
            }}
          >
            <h2 id="ws-del">Delete {saved.name}?</h2>
            <p>
              Type <b>{saved.slug}</b> to confirm. Everything in this workspace is removed permanently.
            </p>
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus aria-label="Workspace URL to confirm" />
            <div className="dialog-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-danger btn-sm" disabled={confirm !== saved.slug}>
                Delete workspace
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function Team() {
  const [members, setMembers] = useState(MEMBERS)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('Editor')
  const [err, setErr] = useState('')

  return (
    <div className="stack">
      <Card title="Invite people">
        <form
          className="invite"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            const v = email.trim().toLowerCase()
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setErr('Enter a valid email address.')
            if (members.some((m) => m.email === v)) return setErr('That person is already in the workspace.')
            setMembers((ms) => [...ms, { name: v.split('@')[0], email: v, role, initials: v.slice(0, 2).toUpperCase(), active: 'Invited' }])
            setEmail('')
            setErr('')
            toast(`Invite drafted for ${v} — emails need the backend`)
          }}
        >
          <input
            className="input grow"
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setErr('')
            }}
            aria-label="Email address"
            aria-invalid={!!err}
          />
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            {ROLES.slice(1).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary btn-sm">
            Send invite
          </button>
        </form>
        {err && <small className="is-bad form-err">{err}</small>}
      </Card>

      <Card title="Members" meta={`${members.length} people`} flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Last active</th>
                <th className="num">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.email}>
                  <td>
                    <div className="member">
                      <Avatar initials={m.initials} size={30} />
                      <span>
                        <b>{m.name}</b>
                        <small>{m.email}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    {m.role === 'Owner' ? (
                      <span className="muted">Owner</span>
                    ) : (
                      <select
                        className="select select-sm"
                        value={m.role}
                        aria-label={`Role for ${m.name}`}
                        onChange={(e) => {
                          const r = e.target.value
                          setMembers((ms) => ms.map((x) => (x.email === m.email ? { ...x, role: r } : x)))
                          toast(`${m.name} is now ${r === 'Admin' || r === 'Editor' ? 'an' : 'a'} ${r}`)
                        }}
                      >
                        {ROLES.slice(1).map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="muted">{m.active}</td>
                  <td className="num">
                    {m.role !== 'Owner' && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => {
                          setMembers((ms) => ms.filter((x) => x.email !== m.email))
                          toast(`Removed ${m.name}`)
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

const INVOICES = [
  ['Nov 1, 2026', 'Pro · yearly', '$228.00', 'Paid'],
  ['Nov 1, 2025', 'Pro · yearly', '$228.00', 'Paid'],
  ['Oct 1, 2025', 'Creator → Pro, prorated', '$17.40', 'Paid'],
]

function Billing() {
  const rows = [
    { label: 'Storage', ...USAGE.storage },
    { label: 'Transcode minutes', ...USAGE.transcode },
    { label: 'Bandwidth', ...USAGE.bandwidth },
    { label: 'Caption hours', ...USAGE.captions },
  ]
  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="Usage this cycle" meta="Resets Dec 1">
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
            <span className="plan-name">Pro</span>
            <div className="plan-cost">
              <strong>$19</strong>
              <span>/ month, billed yearly</span>
            </div>
            <p>2 TB storage, 4K HDR streaming, 1,000 transcode minutes and AI captions in 40+ languages.</p>
            <div className="form-actions">
              <Link href="/#pricing" className="btn btn-primary btn-sm">
                Change plan
              </Link>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => toast('Payment details are managed by the billing provider once connected')}>
                <Icon name="card" size={15} /> Payment method
              </button>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Invoices" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {INVOICES.map(([d, desc, amt, st]) => (
                <tr key={d + desc}>
                  <td className="muted">{d}</td>
                  <td>{desc}</td>
                  <td className="num">{amt}</td>
                  <td>
                    <span className="dot-status is-good">{st}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export default function Settings() {
  const params = useSearchParams()
  const router = useRouter()
  const raw = params.get('tab')
  const tab: Tab = raw === 'team' || raw === 'billing' ? raw : 'general'

  return (
    <>
      <PageHead title="Settings" sub={`${WORKSPACE.name} · ${WORKSPACE.plan} plan`} />
      <Tabs
        value={tab}
        onChange={(t) => router.replace(t === 'general' ? '/dashboard/settings' : `/dashboard/settings?tab=${t}`, { scroll: false })}
        tabs={[
          { value: 'general', label: 'General' },
          { value: 'team', label: 'Team', count: MEMBERS.length },
          { value: 'billing', label: 'Billing' },
        ]}
      />
      {tab === 'general' && <General />}
      {tab === 'team' && <Team />}
      {tab === 'billing' && <Billing />}
    </>
  )
}
