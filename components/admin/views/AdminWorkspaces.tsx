'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Card, PageHead, Segmented } from '../../app/ui'
import { Loading, Pager, Pill, PlanPill, day, fmtBytes, useAdmin } from '../kit'

type Workspace = {
  id: string
  name: string
  slug: string
  createdAt: string
  suspendedAt: string | null
  planOverride: string | null
  plan: string
  members: number
  assets: number
  bytes: number
  owner: string | null
  subStatus: string | null
}
type Status = 'all' | 'paid' | 'suspended' | 'override'

export default function AdminWorkspaces() {
  const params = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const [q, setQ] = useState(params.get('q') ?? '')
  const status = (params.get('status') as Status) || 'all'
  const offset = Number(params.get('offset')) || 0
  const qs = new URLSearchParams({ ...(params.get('q') ? { q: params.get('q')! } : {}), status, offset: String(offset), limit: '50' })
  const { data, error } = useAdmin<{ workspaces: Workspace[]; total: number; limit: number; offset: number }>(`/api/admin/workspaces?${qs}`)
  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k)
    if (!('offset' in next)) p.delete('offset')
    router.replace(`${path}?${p}`)
  }

  return (
    <>
      <PageHead title="Workspaces" sub={data ? `${data.total.toLocaleString('en-US')} ${status === 'all' ? 'workspaces' : 'matching'}` : 'Every workspace on MediaEX.'} />
      <div className="filters">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            go({ q: q.trim() })
          }}
        >
          <input className="input" placeholder="Name, slug, member email or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search workspaces" />
        </form>
        <Segmented
          label="Show"
          value={status}
          onChange={(s) => go({ status: s === 'all' ? '' : s })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'paid', label: 'Paying' },
            { value: 'override', label: 'Plan override' },
            { value: 'suspended', label: 'Suspended' },
          ]}
        />
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="table is-clickable">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Plan</th>
                  <th className="num">Members</th>
                  <th className="num">Assets</th>
                  <th className="num">Storage</th>
                  <th className="num">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.workspaces.map((w) => (
                  <tr key={w.id} onClick={() => router.push(`/admin/workspaces/${w.id}`)}>
                    <td>
                      <Link href={`/admin/workspaces/${w.id}`} className="cell-strong" onClick={(e) => e.stopPropagation()}>
                        {w.name}
                      </Link>
                      {w.suspendedAt && <Pill tone="bad">Suspended</Pill>}
                      <small className="acell-sub">{w.owner ?? w.slug}</small>
                    </td>
                    <td>
                      <span className="apills">
                        <PlanPill plan={w.plan} override={Boolean(w.planOverride)} />
                        {w.subStatus === 'past_due' && <Pill tone="warn">Past due</Pill>}
                      </span>
                    </td>
                    <td className="num">{w.members}</td>
                    <td className="num">{w.assets}</td>
                    <td className="num">{fmtBytes(w.bytes)}</td>
                    <td className="num muted">{day(w.createdAt)}</td>
                  </tr>
                ))}
                {!data.workspaces.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No workspaces match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager total={data.total} limit={data.limit} offset={data.offset} onPage={(o) => go({ offset: String(o) })} />
        </Card>
      )}
    </>
  )
}
