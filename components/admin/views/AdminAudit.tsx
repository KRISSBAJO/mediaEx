'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Card, PageHead } from '../../app/ui'
import { ACTION_LABEL, Loading, Pager, targetHref, useAdmin, when, type AuditEntry } from '../kit'

const GROUPS = [
  { value: '', label: 'All actions' },
  { value: 'user.', label: 'Users' },
  { value: 'user.impersonate', label: 'Impersonation' },
  { value: 'workspace.', label: 'Workspaces' },
  { value: 'asset.', label: 'Media' },
  { value: 'admin.', label: 'Admins' },
  { value: 'ops.', label: 'Operations' },
]

/** What an entry was about, in a few words. */
function about(e: AuditEntry) {
  const d = e.details ?? {}
  const name = (d.email ?? d.name ?? d.title) as string | undefined
  const extra = [d.reason && `“${d.reason}”`, d.plan !== undefined && `plan ${d.plan ?? 'none'}`, d.count !== undefined && `${d.count} jobs`, d.assetsDeleted !== undefined && `${d.assetsDeleted} assets deleted`]
    .filter(Boolean)
    .join(' · ')
  return [name, extra].filter(Boolean).join(' · ')
}

export default function AdminAudit() {
  const params = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const [q, setQ] = useState(params.get('q') ?? '')
  const qs = new URLSearchParams({ limit: '100' })
  for (const k of ['q', 'action', 'offset']) if (params.get(k)) qs.set(k, params.get(k)!)
  const { data, error } = useAdmin<{ entries: AuditEntry[]; total: number; limit: number; offset: number }>(`/api/admin/audit?${qs}`)
  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k)
    if (!('offset' in next)) p.delete('offset')
    router.replace(`${path}?${p}`)
  }
  return (
    <>
      <PageHead title="Audit log" sub="Every site admin action, and every impersonation. Entries can’t be edited or removed from here." />
      <div className="filters">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            go({ q: q.trim() })
          }}
        >
          <input className="input" placeholder="Admin, email, ID or reason" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the audit log" />
        </form>
        <select className="select" value={params.get('action') ?? ''} onChange={(e) => go({ action: e.target.value })} aria-label="Action">
          {GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Admin</th>
                  <th>Action</th>
                  <th>About</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => {
                  const href = targetHref(e.targetType, e.targetId)
                  return (
                    <tr key={e.id}>
                      <td className="muted nowrap">{when(e.createdAt)}</td>
                      <td>{e.adminEmail ?? '—'}</td>
                      <td className="cell-strong">{ACTION_LABEL[e.action] ?? e.action}</td>
                      <td>{href && !e.action.endsWith('.delete') ? <Link href={href}>{about(e) || e.targetId}</Link> : about(e) || e.targetId || '—'}</td>
                    </tr>
                  )
                })}
                {!data.entries.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Nothing recorded yet.
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
