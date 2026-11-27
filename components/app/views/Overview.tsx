'use client'

import Link from 'next/link'
import { isActive, type MediaAsset } from '@/lib/media/types'
import { compact } from '@/lib/sample'
import { useAnalytics } from './Analytics'
import { useMedia } from '../media'
import { Card, PageHead, StatusBadge, Thumb } from '../ui'

function displayTitle(asset: MediaAsset) {
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}(?:\.\w+)?$/i.test(asset.title)) return asset.title
  const kind = asset.type
  if (asset.width && asset.height) {
    const orientation = asset.height > asset.width ? 'Portrait' : asset.height < asset.width ? 'Landscape' : 'Square'
    return `${orientation} ${kind}`
  }
  return `Untitled ${kind}`
}

export default function Overview() {
  const { assets } = useMedia()
  const { data, error } = useAnalytics('30d')
  const recent = assets.slice(0, 3)
  const jobs = assets.filter(asset => isActive(asset) || asset.status === 'failed')
  const totals = data?.totals

  return (
    <div className="overview-home">
      <PageHead title="Workspace overview" />
      <div className="overview-work">
        <Card title="Recent uploads" flush action={<Link className="panel-link" href="/dashboard/library">View library →</Link>}>
          {recent.length ? (
            <ul className="overview-uploads">
              {recent.map(asset => (
                <li key={asset.id}>
                  <Link href={`/dashboard/library/${asset.id}`} className="overview-asset">
                    <Thumb asset={asset} />
                    <strong>{displayTitle(asset)}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty"><p>Your uploads will appear here.</p><Link href="/dashboard/uploads" className="btn btn-primary btn-sm">Upload files</Link></div>
          )}
        </Card>
        <Card title="Upload status" action={<Link className="panel-link" href="/dashboard/uploads">View uploads →</Link>}>
          {jobs.length ? (
            <ul className="overview-jobs">
              {jobs.slice(0, 3).map(asset => (
                <li key={asset.id}>
                  <Link href={`/dashboard/library/${asset.id}`}>{displayTitle(asset)}</Link>
                  <StatusBadge status={asset.status} progress={asset.progress} />
                </li>
              ))}
            </ul>
          ) : <p className="quiet-note">No active or failed uploads.</p>}
        </Card>
      </div>
      <Card title="Audience" meta="Last 30 days" action={<Link className="panel-link" href="/dashboard/analytics">View analytics →</Link>}>
        {error ? <p role="status" className="quiet-note">Audience metrics are unavailable.</p> : (
          <dl className="overview-numbers">
            <div><dt>Views</dt><dd>{totals ? compact(totals.views) : '—'}</dd></div>
            <div><dt>Watch time</dt><dd>{totals ? `${Math.round(totals.watchHours * 60).toLocaleString()} min` : '—'}</dd></div>
          </dl>
        )}
      </Card>
    </div>
  )
}
