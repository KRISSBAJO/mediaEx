'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { MediaAsset } from '@/lib/media/types'
import { bytes } from '@/lib/sample'
import { canManage, useAccount } from '../account'
import { request, useLibrary } from '../library'
import { useMedia } from '../media'
import { Card, toast } from '../ui'

type Trashed = { id: string; title: string; fileName: string; deletedAt: string; expiresAt: string }
type Versions = { current: string; versions: { id: string; fileName: string; size: number; createdAt: string }[]; history: { action: string; actor: string; createdAt: string }[] }
const date = (value: string) => new Date(value).toLocaleString()
const message = (e: unknown) => e instanceof Error ? e.message : 'Request failed.'

function useRecoveryData<T>(path: string | null, workspaceId: string) {
  const [result, setResult] = useState<{ path: string; workspaceId: string; data: T } | null>(null)
  const [error, setError] = useState('')
  const [serial, setSerial] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    if (path) request<T>(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ path, workspaceId, data })
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)) })
    return () => controller.abort()
  }, [path, workspaceId, serial])
  return { data: result?.path === path && result?.workspaceId === workspaceId ? result.data : null, error, reload: () => setSerial(v => v + 1) }
}

export function TrashView() {
  const { workspace } = useAccount()
  const media = useMedia()
  const library = useLibrary()
  const manager = canManage(workspace.role)
  const { data, error, reload } = useRecoveryData<{ assets: Trashed[] }>(manager ? '/api/assets/trash' : null, workspace.id)
  const [busy, setBusy] = useState('')
  async function restore(id: string) {
    setBusy(id)
    try {
      await request('/api/assets/' + id + '/restore', { method: 'POST' })
      reload()
      await Promise.all([media.refresh(), library.reload()])
      toast('Asset restored to the library')
    } catch (e) { toast(message(e)) } finally { setBusy('') }
  }
  return <>
    <div className="page-head"><h1>Trash</h1></div>
    {manager ? <Card title="Deleted assets" meta="30-day recovery window">
      {error ? <p role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={reload}>Try again</button></p> :
        !data ? <p role="status">Loading Trash…</p> : !data.assets.length ? <p className="empty">Trash is empty.</p> :
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Asset</th><th>Deleted</th><th>Recover until</th><th aria-label="Actions" /></tr></thead>
          <tbody>{data.assets.map(asset => <tr key={asset.id}>
            <td><strong>{asset.title}</strong><br />{asset.fileName}</td>
            <td><time dateTime={asset.deletedAt}>{date(asset.deletedAt)}</time></td>
            <td><time dateTime={asset.expiresAt}>{date(asset.expiresAt)}</time></td>
            <td><button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void restore(asset.id)}>{busy === asset.id ? 'Restoring…' : 'Restore'}</button></td>
          </tr>)}</tbody></table></div>}
    </Card> : <p>Workspace owners and admins can restore deleted assets.</p>}
  </>
}

export function VersionPanel({ asset, onChanged }: { asset: MediaAsset; onChanged: () => Promise<void> }) {
  const { workspace } = useAccount()
  const { assets } = useMedia()
  const path = '/api/assets/' + asset.id + '/revisions'
  const { data, error, reload } = useRecoveryData<Versions>(path, workspace.id)
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  async function change(selection: { replacementId: string } | { restoreRevisionId: string }) {
    if (!data || busy) return
    setBusy(true)
    try {
      await request(path, { method: 'POST', json: { ...selection, expectedCurrent: data.current } })
      setSource('')
      reload()
      await onChanged()
      toast('Current asset version updated')
    } catch (e) { toast(message(e)); reload() } finally { setBusy(false) }
  }
  return <Card title="Version history">
    {!data || error ? <p role="status">{error || 'Loading versions…'} {error && <button className="btn btn-ghost btn-sm" onClick={reload}>Try again</button>}</p> : <div className="stack">
      <div><strong>Current file</strong><p>{asset.fileName} · {bytes(asset.size)}</p></div>
      {data.versions.length > 0 && <ul>{data.versions.map(version => <li key={version.id}><strong>{version.fileName}</strong> · {bytes(Number(version.size))} · <time dateTime={version.createdAt}>{date(version.createdAt)}</time>{' '}
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void change({ restoreRevisionId: version.id })}>Restore version</button></li>)}</ul>}
      <details><summary>Publish a replacement</summary>
        <p><Link href="/dashboard/uploads">Upload the new file</Link>, then choose its asset ID. Its separate share link will close. This asset keeps its link and previous versions.</p>
        <form onSubmit={e => { e.preventDefault(); void change({ replacementId: source.trim() }) }}>
          <label>Replacement asset ID<input className="input" list="replacement-uploads" placeholder="ast_…" required pattern="ast_[a-z0-9]{6,20}" value={source} onChange={e => setSource(e.target.value)} /></label>
          <datalist id="replacement-uploads">{assets.filter(a => a.id !== asset.id && a.type === asset.type && a.status === 'ready').map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</datalist>
          <button className="btn btn-primary btn-sm" disabled={busy || !source.trim()}>Publish version</button>
        </form>
      </details>
      {data.history.length > 0 && <details><summary>Recovery activity</summary><ul>{data.history.map((event, index) =>
        <li key={event.createdAt + index}>{event.action} · {date(event.createdAt)} · {event.actor}</li>)}</ul></details>}
    </div>}
  </Card>
}
