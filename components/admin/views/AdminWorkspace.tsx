'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Icon from '../../app/Icon'
import { Card, PageHead, StatTile } from '../../app/ui'
import StorageCredential, { type CredentialStatus } from './StorageCredential'
import { AuditList, Back, Confirm, Loading, Pill, PlanPill, act, day, fmtBytes, useAdmin, when, type AuditEntry } from '../kit'

type Detail = {
  workspace: {
    id: string
    name: string
    slug: string
    createdAt: string
    suspendedAt: string | null
    suspendReason: string | null
    planOverride: string | null
    overrideUntil: string | null
    note: string | null
    plan: string
    subPlan: string | null
    subStatus: string | null
    interval: string | null
    provider: string | null
    customerId: string | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean | null
  }
  members: { id: string; name: string; email: string; banned: boolean | null; role: string; createdAt: string }[]
  usage: { assets: number; bytes: number; failed: number; takenDown: number; minutesThisMonth: number; views30d: number }
  assets: { id: string; title: string; type: string; status: string; moderation: string; takenDown: string | null; size: number; createdAt: string }[]
  developer: { keys: number; webhooks: number }
  settings: { moderationMode: string; aiReview: boolean; extraCodecs: string[]; autoCaptions: boolean } | null
  audit: AuditEntry[]
  storageCredential: CredentialStatus | null
}

export default function AdminWorkspace({ id, operatorConnected }: { id: string; operatorConnected: boolean }) {
  const router = useRouter()
  const { data, error, setData, reload } = useAdmin<Detail>(`/api/admin/workspaces/${id}`)
  const operator = useAdmin<CredentialStatus>(operatorConnected ? `/api/admin/workspaces/${id}/storage-credential` : null)
  const [dialog, setDialog] = useState<'suspend' | 'delete' | 'plan' | null>(null)
  const [plan, setPlan] = useState('pro')
  const [until, setUntil] = useState('')
  const [note, setNote] = useState<string | null>(null)
  if (!data) return <Loading error={error} />
  const credential = operatorConnected
    ? operator.error ? { state: 'unavailable' as const } : operator.data
    : data.storageCredential
  const refreshCredential = () => {
    if (operatorConnected) operator.reload()
    reload()
  }
  const w = data.workspace
  const run = async (action: string, json?: unknown, done?: string) => {
    const r = await act<Detail>(`/api/admin/workspaces/${id}/${action}`, { json, done })
    if (r && 'workspace' in r) setData(r)
  }
  const providerUrl = w.customerId
    ? w.provider === 'stripe'
      ? `https://dashboard.stripe.com/customers/${w.customerId}`
      : w.provider === 'paystack'
        ? `https://dashboard.paystack.com/#/customers/${w.customerId}`
        : null
    : null

  return (
    <>
      <Back href="/admin/workspaces" label="Workspaces" />
      <PageHead title={w.name} sub={`${w.slug} · created ${day(w.createdAt)}`}>
        <div className="aactions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('plan')}>
            Change plan
          </button>
          {w.suspendedAt ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => run('unsuspend', {}, 'Workspace restored')}>
              Restore workspace
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('suspend')}>
              Suspend
            </button>
          )}
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setDialog('delete')}>
            Delete
          </button>
        </div>
      </PageHead>

      {w.suspendedAt && (
        <div className="banner is-bad" role="status">
          <Icon name="alert" />
          <div>
            <b>Suspended {when(w.suspendedAt)}.</b> {w.suspendReason}
            <small>Members can’t use the dashboard or API keys, nothing new is encoded, and its media doesn’t play for anyone outside the workspace.</small>
          </div>
        </div>
      )}

      <div className="grid-ruled stat-tiles">
        <StatTile label="Plan" value={w.plan[0].toUpperCase() + w.plan.slice(1)} unit={w.planOverride ? `override${w.overrideUntil ? ` until ${day(w.overrideUntil)}` : ''}` : undefined} />
        <StatTile label="Storage" value={fmtBytes(data.usage.bytes)} unit={`${data.usage.assets} assets`} />
        <StatTile label="Processing this month" value={`${Math.round(data.usage.minutesThisMonth)}`} unit="min" />
        <StatTile label="Views, 30 days" value={data.usage.views30d.toLocaleString('en-US')} />
      </div>

      <div className="grid-2">
        <div className="stack">
          <Card title="Members" meta={`${data.members.length}`} flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th className="num">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link href={`/admin/users/${m.id}`} className="cell-strong">
                          {m.name}
                        </Link>
                        {m.banned && <Pill tone="bad">Suspended</Pill>}
                        <small className="acell-sub">{m.email}</small>
                      </td>
                      <td className="muted">{m.role}</td>
                      <td className="num muted">{day(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card
            title="Recent media"
            meta={`${data.usage.failed} failed · ${data.usage.takenDown} taken down`}
            flush
            action={
              <Link href={`/admin/media?workspace=${id}`} className="panel-link">
                All media <Icon name="arrowRight" size={14} />
              </Link>
            }
          >
            {data.assets.length ? (
              <ul className="rows">
                {data.assets.map((a) => (
                  <li key={a.id}>
                    <Link href={`/admin/media?q=${a.id}`} className="asset-cell">
                      <span>
                        <b>{a.title}</b>
                        <small>
                          {a.type} · {fmtBytes(Number(a.size))} · {day(a.createdAt)}
                        </small>
                      </span>
                    </Link>
                    <span className="apills">
                      {a.takenDown ? <Pill tone="bad">Taken down</Pill> : a.status === 'failed' ? <Pill tone="bad">Failed</Pill> : <Pill>{a.status}</Pill>}
                      {a.moderation !== 'approved' && <Pill tone="warn">{a.moderation}</Pill>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet-note acard-pad">No media yet.</p>
            )}
          </Card>
        </div>
        <div className="stack">
          {credential && <StorageCredential workspace={id} status={credential} connected={operatorConnected} refresh={refreshCredential} />}
          <Card title="Billing">
            <dl className="details">
              <div>
                <dt>Plan now</dt>
                <dd>
                  <PlanPill plan={w.plan} override={Boolean(w.planOverride)} />
                </dd>
              </div>
              <div>
                <dt>Subscription</dt>
                <dd>
                  {w.subPlan && w.subStatus
                    ? `${w.subPlan} · ${w.interval ?? ''} · ${w.subStatus.replace('_', ' ')}${w.cancelAtPeriodEnd ? ' · cancels' : ''}${w.currentPeriodEnd ? ` · to ${day(w.currentPeriodEnd)}` : ''}`
                    : 'None (Creator)'}
                </dd>
              </div>
              {providerUrl && (
                <div>
                  <dt>Provider</dt>
                  <dd>
                    <a href={providerUrl} target="_blank" rel="noreferrer">
                      Open in {w.provider === 'stripe' ? 'Stripe' : 'Paystack'} ↗
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </Card>
          <Card title="Setup">
            <dl className="details">
              <div>
                <dt>Workspace ID</dt>
                <dd className="mono">{w.id}</dd>
              </div>
              <div>
                <dt>Developers</dt>
                <dd>
                  {data.developer.keys} API {data.developer.keys === 1 ? 'key' : 'keys'} · {data.developer.webhooks} webhook {data.developer.webhooks === 1 ? 'endpoint' : 'endpoints'}
                </dd>
              </div>
              <div>
                <dt>Moderation</dt>
                <dd>
                  {data.settings?.moderationMode ?? 'off'}
                  {data.settings?.aiReview ? ' · automatic review' : ''}
                </dd>
              </div>
              <div>
                <dt>Encoding</dt>
                <dd>
                  H.264{data.settings?.extraCodecs?.length ? `, ${data.settings.extraCodecs.map((c) => c.toUpperCase()).join(', ')}` : ''}
                  {data.settings?.autoCaptions ? ' · automatic captions' : ''}
                </dd>
              </div>
            </dl>
          </Card>
          <Card
            title="Internal note"
            meta="Admins only"
            action={
              note !== null ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={async () => {
                    await run('note', { note }, 'Note saved')
                    setNote(null)
                  }}
                >
                  Save
                </button>
              ) : undefined
            }
          >
            <textarea className="input anote" rows={4} value={note ?? w.note ?? ''} onChange={(e) => setNote(e.target.value)} placeholder="Context for other admins: a deal, a support case, why it was suspended…" />
          </Card>
          <Card title="Admin activity" meta="On this workspace" flush>
            <AuditList entries={data.audit} />
          </Card>
        </div>
      </div>

      {dialog === 'suspend' && (
        <Confirm
          title={`Suspend ${w.name}?`}
          body={<p>Members are locked out of the dashboard and API, nothing new is encoded, and its media stops playing publicly. Nothing is deleted; you can restore it any time.</p>}
          reason="Reason (shown to the workspace’s members)"
          action="Suspend workspace"
          danger
          onClose={() => setDialog(null)}
          onConfirm={(reason) => run('suspend', { reason }, 'Workspace suspended')}
        />
      )}
      {dialog === 'delete' && (
        <Confirm
          title={`Delete ${w.name}?`}
          body={<p>This deletes the workspace, its {data.usage.assets} assets and every file stored for them ({fmtBytes(data.usage.bytes)}), its API keys and webhooks. Members keep their accounts. This can’t be undone.</p>}
          action="Delete workspace"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (await act(`/api/admin/workspaces/${id}`, { method: 'DELETE', done: 'Workspace deleted' })) router.push('/admin/workspaces')
          }}
        />
      )}
      {dialog === 'plan' && (
        <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && setDialog(null)}>
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-title"
            onSubmit={async (e) => {
              e.preventDefault()
              await run('plan', { plan, until: until ? new Date(`${until}T23:59:59`).toISOString() : null }, `Plan set to ${plan}`)
              setDialog(null)
            }}
          >
            <h2 id="plan-title">Change {w.name}’s plan</h2>
            <p>An override gives this workspace a plan’s limits without billing them: a comp, a trial, or a fix. It wins over their subscription until it ends.</p>
            <label className="field-d">
              <span>Plan</span>
              <select className="select" value={plan} onChange={(e) => setPlan(e.target.value)}>
                <option value="creator">Creator</option>
                <option value="pro">Pro</option>
                <option value="studio">Studio</option>
              </select>
            </label>
            <label className="field-d">
              <span>Until (leave empty for no end)</span>
              <input className="input" type="date" value={until} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setUntil(e.target.value)} />
            </label>
            <div className="dialog-foot">
              {w.planOverride && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await run('plan', { plan: null }, 'Override removed')
                    setDialog(null)
                  }}
                >
                  Remove override
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm">
                Set plan
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
