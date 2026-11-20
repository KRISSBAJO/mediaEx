'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Card, PageHead } from '../../app/ui'
import { Confirm, Loading, Pill, act, ago, useAdmin } from '../kit'

type Admins = { admins: { id: string; name: string; email: string; createdAt: string; lastSeenAt: string | null; bootstrap: boolean }[]; pending: string[] }

export default function AdminAdmins() {
  const { data, error, setData } = useAdmin<Admins>('/api/admin/admins')
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Admins['admins'][number] | null>(null)
  if (!data) return <Loading error={error} />

  return (
    <>
      <PageHead title="Admins" sub="People who can see and act on every account, workspace and asset on MediaEX." />
      <div className="grid-2">
        <Card title="Site admins" meta={`${data.admins.length}`} flush>
          <ul className="rows">
            {data.admins.map((a) => (
              <li key={a.id}>
                <Link href={`/admin/users/${a.id}`} className="asset-cell">
                  <span>
                    <b>
                      {a.name} {a.bootstrap && <Pill>SITE_ADMIN_EMAILS</Pill>}
                    </b>
                    <small>
                      {a.email} · last active {ago(a.lastSeenAt)}
                    </small>
                  </span>
                </Link>
                {!a.bootstrap && (
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRemoving(a)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <div className="stack">
          <Card title="Add an admin">
            <form
              className="copy-row"
              onSubmit={async (e) => {
                e.preventDefault()
                setAdding(true)
                const r = await act<Admins>('/api/admin/admins', { json: { email }, done: `${email} is a site admin now` })
                setAdding(false)
                if (r?.admins) {
                  setData(r)
                  setEmail('')
                }
              }}
            >
              <input className="input" type="email" required placeholder="their account email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
              <button type="submit" className="btn btn-primary btn-sm" disabled={adding || !email}>
                Make admin
              </button>
            </form>
            <p className="access-note aspace">They need a MediaEX account first. Admins added here can be removed here; the ones in SITE_ADMIN_EMAILS can only be removed by changing that setting.</p>
          </Card>
          {data.pending.length > 0 && (
            <Card title="Waiting to sign up" meta="In SITE_ADMIN_EMAILS">
              <p className="access-note">These become admins the moment they create an account: {data.pending.join(', ')}.</p>
            </Card>
          )}
        </div>
      </div>
      {removing && (
        <Confirm
          title={`Remove ${removing.name} as an admin?`}
          body={<p>They keep their account and workspaces, and lose access to the site admin area straight away.</p>}
          action="Remove admin"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const r = await act<Admins>(`/api/admin/admins/${removing.id}`, { method: 'DELETE', done: 'Admin removed' })
            if (r?.admins) setData(r)
          }}
        />
      )}
    </>
  )
}
