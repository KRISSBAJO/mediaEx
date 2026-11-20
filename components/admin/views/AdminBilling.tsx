'use client'

import Link from 'next/link'
import { BarList } from '../../app/charts'
import Icon from '../../app/Icon'
import { Card, PageHead, StatTile } from '../../app/ui'
import { Loading, Pill, day, money, useAdmin, when } from '../kit'

type Sub = {
  organizationId: string
  workspaceName: string
  plan: string
  interval: string | null
  provider: string | null
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  providerUrl: string | null
  updatedAt: string
}
type Billing = {
  provider: string | null
  mrr: number
  arr: number
  paidWorkspaces: number
  workspaces: number
  byPlan: { plan: string; count: number; mrr: number }[]
  yearlyShare: number
  pastDue: Sub[]
  cancelling: Sub[]
  subscriptions: Sub[]
  overrides: { id: string; name: string; planOverride: string; overrideUntil: string | null }[]
  events: { provider: string; eventId: string; type: string; receivedAt: string }[]
}

function SubTable({ rows, empty }: { rows: Sub[]; empty: string }) {
  if (!rows.length) return <p className="quiet-note acard-pad">{empty}</p>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Workspace</th>
            <th>Plan</th>
            <th>Status</th>
            <th className="num">Period ends</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.organizationId}>
              <td>
                <Link href={`/admin/workspaces/${s.organizationId}`} className="cell-strong">
                  {s.workspaceName}
                </Link>
              </td>
              <td>
                {s.plan} · {s.interval === 'year' ? 'yearly' : 'monthly'}
              </td>
              <td>
                <span className="apills">
                  <Pill tone={s.status === 'active' ? 'good' : s.status === 'past_due' ? 'warn' : s.status === 'canceled' ? 'bad' : undefined}>{s.status.replace('_', ' ')}</Pill>
                  {s.cancelAtPeriodEnd && <Pill>Cancels</Pill>}
                </span>
              </td>
              <td className="num muted">{day(s.currentPeriodEnd)}</td>
              <td className="num">
                {s.providerUrl && (
                  <a href={s.providerUrl} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm">
                    {s.provider === 'stripe' ? 'Stripe' : 'Paystack'} ↗
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AdminBilling() {
  const { data, error } = useAdmin<Billing>('/api/admin/billing')
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageHead title="Billing" sub={data.provider ? `Payments through ${data.provider === 'stripe' ? 'Stripe' : 'Paystack'}.` : 'No payment provider is configured, so every workspace is on Creator unless overridden.'} />
      <div className="grid-ruled stat-tiles">
        <StatTile label="Monthly recurring revenue" value={money(data.mrr)} />
        <StatTile label="Annual run rate" value={money(data.arr)} />
        <StatTile label="Paying workspaces" value={String(data.paidWorkspaces)} unit={`of ${data.workspaces}`} />
        <StatTile label="On yearly billing" value={`${Math.round(data.yearlyShare * 100)}`} unit="%" />
      </div>
      <div className="grid-2">
        <div className="stack">
          <Card title="Past due" meta="Payment failed; 7 days’ grace" flush>
            <SubTable rows={data.pastDue} empty="No failed payments." />
          </Card>
          <Card title="Cancelling" meta="Paid to the period end, then Creator" flush>
            <SubTable rows={data.cancelling} empty="Nobody is cancelling." />
          </Card>
          <Card title="All subscriptions" meta={`${data.subscriptions.length}`} flush>
            <SubTable rows={data.subscriptions} empty="No subscriptions yet." />
          </Card>
        </div>
        <div className="stack">
          <Card title="Revenue by plan" meta="Monthly">
            <BarList points={data.byPlan.map((p) => ({ label: `${p.plan[0].toUpperCase() + p.plan.slice(1)} · ${p.count}`, value: p.mrr }))} format={money} />
          </Card>
          <Card title="Plan overrides" meta="Comps and trials, not billed" flush>
            {data.overrides.length ? (
              <ul className="rows">
                {data.overrides.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/workspaces/${o.id}`} className="asset-cell">
                      <span>
                        <b>{o.name}</b>
                        <small>
                          {o.planOverride} · {o.overrideUntil ? `until ${day(o.overrideUntil)}` : 'no end date'}
                        </small>
                      </span>
                    </Link>
                    <Icon name="arrowRight" size={14} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet-note acard-pad">No overrides.</p>
            )}
          </Card>
          <Card title="Provider events" meta="Newest webhooks received" flush>
            {data.events.length ? (
              <ul className="rows">
                {data.events.map((e) => (
                  <li key={`${e.provider}-${e.eventId}`}>
                    <span>
                      <b className="mono-strong">{e.type}</b>
                      <small>
                        {e.provider} · {when(e.receivedAt)}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet-note acard-pad">None received yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
