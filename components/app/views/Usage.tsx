'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { OperationsReport, OperationalError } from '@/backend/media/operations.mts'
import { bytes } from '@/lib/sample'
import { canManage, useAccount } from '../account'
import { request } from '../library'
import { Card, PageHead, StatTile } from '../ui'

const categoryLabels = { encoding: 'Encoding', captions: 'Captions', playback: 'Playback', webhook: 'Webhook delivery' }

function ErrorAction({ issue }: { issue: OperationalError }) {
  if (issue.category === 'webhook') return issue.deliveryId
    ? <Link href={`/dashboard/developers?delivery=${encodeURIComponent(issue.deliveryId)}`}>Review delivery</Link>
    : <span>Delivery unavailable</span>
  if (!issue.assetId) return <span>Asset unavailable</span>
  if (issue.category === 'playback') return <Link href={`/dashboard/analytics?asset=${encodeURIComponent(issue.assetId)}`}>View playback analytics</Link>
  return <Link href={`/dashboard/library/${encodeURIComponent(issue.assetId)}`}>Open asset</Link>
}

function Report({ data }: { data: OperationsReport }) {
  const { workspace } = useAccount()
  const storage = [
    ['Original files', data.originalBytes],
    ['Encoded outputs', data.encodedBytes],
    ['Cached image transforms', data.transformBytes],
    ['Retained previous versions', data.versionBytes],
  ] as const
  const total = storage.reduce((sum, [, value]) => sum + value, 0)
  const credential = data.storageCredential
  return <>
    <div className="grid-ruled stat-tiles">
      <StatTile label="Tracked media storage" value={bytes(total)} />
      <StatTile label="Active upload reservations" value={bytes(data.reservedBytes)} />
      <StatTile label="Processed media · 30 days" value={data.processingMinutes.toLocaleString(undefined, { maximumFractionDigits: 2 })} unit="min" />
      <StatTile label="Worker time · 30 days" value={(data.workerMinutes??0).toLocaleString(undefined,{maximumFractionDigits:2})} unit="min" />
      <StatTile label="Origin bytes over 30 days" value={bytes(data.originBytes ?? 0)} />
      <StatTile label="Storage redirects over 30 days" value={(data.bucketRedirects ?? 0).toLocaleString()} />
      <StatTile label="Player delivery · 30 days" value={bytes(data.playerBytes)} />
    </div>
    <section id="customer-storage" aria-label="Customer-owned S3">
    <Card title="Customer-owned S3" meta={credential?.state === 'active' ? 'Version ' + credential.version : 'Storage pilot'}>
      {!credential ? <p>A site administrator can help connect a customer-owned bucket. Workspace owners and admins can see credential status here once their workspace is enrolled in the pilot.</p> : credential.state === 'active' ? <>
        <p>{credential.actor} verified upload, encoding and playback on {new Date(credential.checkedAt).toLocaleString()}.</p>
        {credential.earliestRetirement && <p>Keep the key for version {credential.previousVersion} active until at least {new Date(credential.earliestRetirement).toLocaleString()}. Check in-flight work before retiring it.</p>}
      </> : <p>{credential.state === 'unavailable' ? 'Credential status is unavailable.' : 'Waiting for the first verified storage credential.'}</p>}
      {canManage(workspace.role) && <p><Link href="/dashboard/settings?tab=backups">Backup copies</Link> &middot; <Link href="/dashboard/settings?tab=retention">Retention settings</Link></p>}
    </Card>
    </section>
    <div className="grid-2 even">
      <Card title="Storage breakdown" meta="Includes files retained in Trash" flush>
        <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">Files</th><th scope="col">Stored</th></tr></thead>
          <tbody>{storage.map(([label, value]) => <tr key={label}><td>{label}</td><td title={value.toLocaleString() + ' bytes'}>{bytes(value)}</td></tr>)}</tbody>
        </table></div>
        <p className="quiet-note">Counts verified uploads, recorded outputs and retained versions. Captions, partial uploads and filesystem overhead are outside these totals.</p>
      </Card>
      <Card title="Upload reservations" meta={data.cleanupEnabled ? 'Automatic cleanup enabled' : 'Cleanup preview'}>
        <p>{data.reservations} active {data.reservations === 1 ? 'upload reserves' : 'uploads reserve'} {bytes(data.reservedBytes)} of workspace capacity.</p>
        <p>{data.expiredUploads} expired {data.expiredUploads === 1 ? 'upload' : 'uploads'} · {bytes(data.expiredBytes)} originally requested.</p>
        <p className="quiet-note">Reservations expire after seven days of inactivity. An expired upload may contain only part of its requested bytes.</p>
      </Card>
    </div>
    <p className="quiet-note">Processed minutes count the duration of completed audio and video encodes. Player delivery counts bytes reported by MediaEX players. Direct downloads and clients that do not send playback reports are outside this measurement. Both totals cover the last 30 UTC dates.</p>
    <Card title="Recent errors" meta={`${data.errors.toLocaleString()} in the last 30 days`} flush>
      {data.details === null ? <p className="quiet-note">Workspace owners and admins can review individual errors.</p>
        : data.details.length === 0 ? <p className="quiet-note">No errors recorded in the last 30 days.</p>
        : <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">Time</th><th scope="col">Operation</th><th scope="col">Affected item</th><th scope="col">Action</th></tr></thead>
          <tbody>{data.details.map(issue => <tr key={issue.id}>
            <td><time dateTime={issue.recordedAt}>{new Date(issue.recordedAt).toLocaleString()}</time></td>
            <td>{categoryLabels[issue.category]}{issue.httpStatus ? ` · HTTP ${issue.httpStatus}` : ''}</td>
            <td>{issue.title || issue.reference}{issue.category === 'captions' && issue.title ? ` (${issue.reference})` : ''}</td>
            <td><ErrorAction issue={issue} /></td>
          </tr>)}</tbody>
        </table>{data.errors > data.details.length && <p className="quiet-note">Showing the latest {data.details.length} errors.</p>}</div>}
    </Card>
  </>
}

export default function Usage() {
  const { workspace } = useAccount()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ orgId: string; attempt: number; data?: OperationsReport; error?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    request<OperationsReport>('/api/analytics/operations', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ orgId: workspace.id, attempt, data })
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setResult({ orgId: workspace.id, attempt, error: error.message })
    })
    return () => controller.abort()
  }, [workspace.id, attempt])
  const current = result?.orgId === workspace.id && result.attempt === attempt ? result : null
  return <>
    <PageHead title="Storage & usage"><button className="btn btn-ghost" type="button" disabled={!current} onClick={() => setAttempt(n => n + 1)}>Refresh</button></PageHead>
    {current?.error ? <p className="banner is-bad" role="alert">{current.error}</p>
      : current?.data ? <Report data={current.data} /> : <p className="quiet-note" role="status">Loading workspace usage…</p>}
  </>
}
