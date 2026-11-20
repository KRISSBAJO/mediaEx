'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Card, PageHead } from '../../app/ui'
import { Confirm, Loading, Pager, Pill, act, day, fmtBytes, useAdmin } from '../kit'

type Asset = {
  id: string
  title: string
  type: string
  status: string
  error: string | null
  moderation: string
  moderationFlags: { reason: string }[]
  takenDown: string | null
  size: number
  outputSize: number
  duration: number
  createdAt: string
  thumbUrl: string | null
  playback: string
  workspaceId: string
  workspaceName: string
  views: number
}

export default function AdminMedia() {
  const params = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [dialog, setDialog] = useState<{ kind: 'takedown' | 'delete'; asset: Asset } | null>(null)
  const keys = ['q', 'status', 'moderation', 'taken', 'workspace', 'offset'] as const
  const qs = new URLSearchParams({ limit: '48' })
  for (const k of keys) if (params.get(k)) qs.set(k, params.get(k)!)
  const { data, error, reload } = useAdmin<{ assets: Asset[]; total: number; limit: number; offset: number }>(`/api/admin/assets?${qs}`)
  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k)
    if (!('offset' in next)) p.delete('offset')
    router.replace(`${path}?${p}`)
  }

  return (
    <>
      <PageHead title="Media" sub={data ? `${data.total.toLocaleString('en-US')} assets${params.get('workspace') && data.assets[0] ? ` in ${data.assets[0].workspaceName}` : ' on the platform'}` : 'Every asset, in every workspace.'} />
      <div className="filters">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            go({ q: q.trim() })
          }}
        >
          <input className="input" placeholder="Title, file name or asset ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search media" />
        </form>
        <select className="select" value={params.get('status') ?? ''} onChange={(e) => go({ status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="queued">Queued</option>
          <option value="uploading">Uploading</option>
          <option value="failed">Failed</option>
        </select>
        <select className="select" value={params.get('moderation') ?? ''} onChange={(e) => go({ moderation: e.target.value })} aria-label="Review">
          <option value="">Any review state</option>
          <option value="pending">In review</option>
          <option value="rejected">Rejected</option>
          <option value="approved">Approved</option>
        </select>
        <label className="acheck">
          <input type="checkbox" checked={params.get('taken') === '1'} onChange={(e) => go({ taken: e.target.checked ? '1' : '' })} /> Taken down only
        </label>
        {params.get('workspace') && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ workspace: '' })}>
            All workspaces ×
          </button>
        )}
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Workspace</th>
                  <th>State</th>
                  <th className="num">Views</th>
                  <th className="num">Size</th>
                  <th className="num">Uploaded</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.assets.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="amedia">
                        {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail route */}
                        {a.thumbUrl ? <img src={a.thumbUrl} alt="" loading="lazy" /> : <i>{a.type}</i>}
                        <span>
                          <b>{a.title}</b>
                          <small className="mono">{a.id}</small>
                          {a.status === 'failed' && a.error && <small className="is-bad">{a.error}</small>}
                          {a.takenDown && <small className="is-bad">Taken down: {a.takenDown}</small>}
                        </span>
                      </span>
                    </td>
                    <td>
                      <Link href={`/admin/workspaces/${a.workspaceId}`}>{a.workspaceName}</Link>
                    </td>
                    <td>
                      <span className="apills">
                        {a.takenDown ? <Pill tone="bad">Taken down</Pill> : a.status === 'failed' ? <Pill tone="bad">Failed</Pill> : <Pill tone={a.status === 'ready' ? 'good' : undefined}>{a.status}</Pill>}
                        {a.moderation !== 'approved' && <Pill tone="warn">{a.moderation === 'pending' ? 'In review' : 'Rejected'}</Pill>}
                        {a.playback === 'signed' && <Pill>Signed</Pill>}
                      </span>
                    </td>
                    <td className="num">{a.views}</td>
                    <td className="num">{fmtBytes(a.size + a.outputSize)}</td>
                    <td className="num muted">{day(a.createdAt)}</td>
                    <td className="num">
                      <span className="arow-actions">
                        {a.status === 'ready' && !a.takenDown && a.moderation === 'approved' && (
                          <a className="btn btn-quiet btn-sm" href={`/embed/${a.id}`} target="_blank" rel="noreferrer">
                            Watch
                          </a>
                        )}
                        {(a.status === 'failed' || a.status === 'ready') && (
                          <button type="button" className="btn btn-quiet btn-sm" onClick={async () => (await act(`/api/admin/assets/${a.id}/retry`, { done: 'Queued to process again' })) && reload()}>
                            Re-run
                          </button>
                        )}
                        {a.takenDown ? (
                          <button type="button" className="btn btn-quiet btn-sm" onClick={async () => (await act(`/api/admin/assets/${a.id}/restore`, { done: 'Restored' })) && reload()}>
                            Restore
                          </button>
                        ) : (
                          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDialog({ kind: 'takedown', asset: a })}>
                            Take down
                          </button>
                        )}
                        <button type="button" className="btn btn-quiet btn-sm is-bad" onClick={() => setDialog({ kind: 'delete', asset: a })}>
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
                {!data.assets.length && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No media matches.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager total={data.total} limit={data.limit} offset={data.offset} onPage={(o) => go({ offset: String(o) })} />
        </Card>
      )}

      {dialog?.kind === 'takedown' && (
        <Confirm
          title={`Take down “${dialog.asset.title}”?`}
          body={<p>It stops playing for everyone outside {dialog.asset.workspaceName} straight away, and they can’t approve it back; only a site admin can restore it. The file is kept.</p>}
          reason="Reason (shown to the workspace)"
          action="Take down"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => (await act(`/api/admin/assets/${dialog.asset.id}/takedown`, { json: { reason }, done: 'Taken down' })) && reload()}
        />
      )}
      {dialog?.kind === 'delete' && (
        <Confirm
          title={`Delete “${dialog.asset.title}”?`}
          body={<p>The original, every rendition and its captions are deleted from {dialog.asset.workspaceName}, and its links stop working. This can’t be undone.</p>}
          action="Delete asset"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => (await act(`/api/admin/assets/${dialog.asset.id}`, { method: 'DELETE', done: 'Asset deleted' })) && reload()}
        />
      )}
    </>
  )
}
