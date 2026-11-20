'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Card, PageHead, Segmented } from '../../app/ui'
import { Loading, Pager, Pill, ago, day, useAdmin } from '../kit'

type User = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  role: string | null
  banned: boolean | null
  banReason: string | null
  createdAt: string
  lastSeenAt: string | null
  workspaces: number
}
type Status = 'all' | 'active' | 'banned' | 'unverified' | 'admins'

export default function AdminUsers() {
  const params = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const [q, setQ] = useState(params.get('q') ?? '')
  const status = (params.get('status') as Status) || 'all'
  const offset = Number(params.get('offset')) || 0
  const qs = new URLSearchParams({ ...(params.get('q') ? { q: params.get('q')! } : {}), status, offset: String(offset), limit: '50' })
  const { data, error } = useAdmin<{ users: User[]; total: number; limit: number; offset: number }>(`/api/admin/users?${qs}`)
  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k)
    if (!('offset' in next)) p.delete('offset')
    router.replace(`${path}?${p}`)
  }

  return (
    <>
      <PageHead title="Users" sub={data ? `${data.total.toLocaleString('en-US')} ${status === 'all' ? 'accounts' : 'matching'}` : 'Everyone with a MediaEX account.'} />
      <div className="filters">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            go({ q: q.trim() })
          }}
        >
          <input className="input" placeholder="Name, email or user ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        </form>
        <Segmented
          label="Show"
          value={status}
          onChange={(s) => go({ status: s === 'all' ? '' : s })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'banned', label: 'Suspended' },
            { value: 'unverified', label: 'Unverified' },
            { value: 'admins', label: 'Admins' },
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
                  <th>User</th>
                  <th>Status</th>
                  <th className="num">Workspaces</th>
                  <th className="num">Joined</th>
                  <th className="num">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} onClick={() => router.push(`/admin/users/${u.id}`)}>
                    <td>
                      <Link href={`/admin/users/${u.id}`} className="cell-strong" onClick={(e) => e.stopPropagation()}>
                        {u.name}
                      </Link>
                      <small className="acell-sub">{u.email}</small>
                    </td>
                    <td>
                      <span className="apills">
                        {u.banned ? <Pill tone="bad">Suspended</Pill> : <Pill tone="good">Active</Pill>}
                        {u.role === 'admin' && <Pill tone="accent">Admin</Pill>}
                        {!u.emailVerified && <Pill tone="warn">Unverified</Pill>}
                      </span>
                    </td>
                    <td className="num">{u.workspaces}</td>
                    <td className="num muted">{day(u.createdAt)}</td>
                    <td className="num muted">{ago(u.lastSeenAt)}</td>
                  </tr>
                ))}
                {!data.users.length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No users match.
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
