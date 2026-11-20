'use client'

import Link from 'next/link'
import { LineChart } from '../../app/charts'
import Icon from '../../app/Icon'
import { Card, PageHead, StatTile } from '../../app/ui'
import { Loading, ago, fmtBytes, money, useAdmin } from '../kit'

type Overview = {
  kpis: {
    users: number
    newUsers7d: number
    banned: number
    workspaces: number
    suspended: number
    assets: number
    storageBytes: number
    minutesThisMonth: number
    views30d: number
    failed24h: number
    inPipeline: number
    pastDue: number
    failingWebhooks: number
    takenDown: number
    inReview: number
    mrr: number
    paidWorkspaces: number
  }
  signups: { day: string; users: number }[]
  recentUsers: { id: string; name: string; email: string; createdAt: string; emailVerified: boolean }[]
  topStorage: { id: string; name: string; bytes: number; assets: number }[]
}

export default function AdminOverview() {
  const { data, error } = useAdmin<Overview>('/api/admin/overview')
  if (!data) return <Loading error={error} />
  const k = data.kpis
  const alerts = [
    { n: k.failed24h, label: 'jobs failed in the last 24 hours', href: '/admin/operations', tone: 'bad' },
    { n: k.pastDue, label: 'subscriptions past due', href: '/admin/billing', tone: 'warn' },
    { n: k.failingWebhooks, label: 'webhook endpoints failing', href: '/admin/operations', tone: 'warn' },
    { n: k.inReview, label: 'assets waiting for review in workspaces', href: '/admin/media?moderation=pending', tone: '' },
    { n: k.takenDown, label: 'assets taken down', href: '/admin/media?taken=1', tone: '' },
    { n: k.suspended, label: 'workspaces suspended', href: '/admin/workspaces?status=suspended', tone: '' },
    { n: k.banned, label: 'users suspended', href: '/admin/users?status=banned', tone: '' },
  ].filter((a) => a.n > 0)

  return (
    <>
      <PageHead title="Platform overview" sub="Everyone on MediaEX: accounts, workspaces, media and revenue." />
      <div className="grid-ruled stat-tiles">
        <StatTile label="Users" value={k.users.toLocaleString('en-US')} unit={k.newUsers7d ? `+${k.newUsers7d} this week` : undefined} points={data.signups.map((s) => ({ label: s.day, value: s.users }))} />
        <StatTile label="Workspaces" value={k.workspaces.toLocaleString('en-US')} unit={`${k.paidWorkspaces} paid`} />
        <StatTile label="Monthly recurring revenue" value={money(k.mrr)} unit={`${money(k.mrr * 12)} a year`} />
        <StatTile label="Storage" value={fmtBytes(k.storageBytes)} unit={`${k.assets.toLocaleString('en-US')} assets`} />
      </div>
      <div className="grid-ruled stat-tiles">
        <StatTile label="Processing minutes this month" value={Math.round(k.minutesThisMonth).toLocaleString('en-US')} />
        <StatTile label="Views, last 30 days" value={k.views30d.toLocaleString('en-US')} />
        <StatTile label="In the pipeline now" value={String(k.inPipeline)} />
        <StatTile label="Failed, last 24 hours" value={String(k.failed24h)} />
      </div>

      <div className="grid-2">
        <div className="stack">
          <Card title="Sign-ups" meta="New users a day, last 30 days">
            <LineChart points={data.signups.map((s) => ({ label: new Date(`${s.day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), value: s.users }))} label="New users per day" height={220} yHead="Users" />
          </Card>
          <Card title="Newest users" flush action={<Link href="/admin/users" className="panel-link">All users <Icon name="arrowRight" size={14} /></Link>}>
            <ul className="rows">
              {data.recentUsers.map((u) => (
                <li key={u.id}>
                  <Link href={`/admin/users/${u.id}`} className="asset-cell">
                    <span>
                      <b>{u.name}</b>
                      <small>
                        {u.email}
                        {u.emailVerified ? '' : ' · not verified'}
                      </small>
                    </span>
                  </Link>
                  <small className="muted">{ago(u.createdAt)}</small>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="stack">
          <Card title="Needs attention" meta={alerts.length ? `${alerts.length} ${alerts.length === 1 ? 'item' : 'items'}` : 'All clear'}>
            {alerts.length ? (
              <ul className="aalerts">
                {alerts.map((a) => (
                  <li key={a.label}>
                    <Link href={a.href}>
                      <b className={a.tone ? `is-${a.tone}` : ''}>{a.n}</b> {a.label}
                      <Icon name="arrowRight" size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet-note">Nothing failing, past due or waiting on you.</p>
            )}
          </Card>
          <Card title="Most storage" flush action={<Link href="/admin/workspaces" className="panel-link">Workspaces <Icon name="arrowRight" size={14} /></Link>}>
            <ul className="rows">
              {data.topStorage.map((w) => (
                <li key={w.id}>
                  <Link href={`/admin/workspaces/${w.id}`} className="asset-cell">
                    <span>
                      <b>{w.name}</b>
                      <small>{w.assets} assets</small>
                    </span>
                  </Link>
                  <small className="muted">{fmtBytes(w.bytes)}</small>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}
