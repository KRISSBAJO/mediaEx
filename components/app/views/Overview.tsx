'use client'

import Link from 'next/link'
import { useState } from 'react'
import { isActive, type MediaAsset } from '@/lib/media/types'
import { bytes, compact, type Range } from '@/lib/sample'
import { useAnalytics } from './Analytics'
import { useMedia } from '../media'
import { Card, PageHead, RANGES, Segmented, StatTile, StatusBadge, Thumb } from '../ui'

const PERIOD: Record<Range, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' }

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
  const [range, setRange] = useState<Range>('30d')
  const { data, error } = useAnalytics(range)
  const recent = assets.slice(0, 3)
  const jobs = assets.filter(asset => isActive(asset) || asset.status === 'failed')
  const t = data?.totals
  const c = data?.change
  const daily = data?.daily ?? []

  return (
    <div className="overview-home">
      <PageHead title="Workspace overview" sub="Track uploads, processing, and audience activity.">
        <Segmented label="Date range" value={range} options={RANGES} onChange={setRange} />
      </PageHead>
      <section aria-labelledby="overview-audience">
        <header className="overview-section-head">
          <h2 id="overview-audience">Audience</h2>
          <p>Views through share links and embeds</p>
        </header>
        {error ? <p role="status" className="quiet-note">Audience metrics are unavailable.</p> : (
          <div className="grid-ruled stat-tiles">
            <StatTile label="Views" value={t ? compact(t.views) : 'ΓÇö'} delta={c?.views ?? undefined} points={daily.map((d) => ({ label: d.date, value: d.views }))} period={PERIOD[range]} />
            <StatTile label="Watch time" value={t ? (t.watchHours >= 100 ? compact(Math.round(t.watchHours)) : t.watchHours.toFixed(1)) : 'ΓÇö'} unit="hrs" delta={c?.watchHours ?? undefined} points={daily.map((d) => ({ label: d.date, value: d.watchHours }))} period={PERIOD[range]} />
            <StatTile label="Avg. time to first frame" value={t?.avgStartupMs != null ? t.avgStartupMs.toLocaleString('en-US') : 'ΓÇö'} unit="ms" delta={c?.avgStartupMs ?? undefined} upIsGood={false} period={PERIOD[range]} />
            <StatTile label="Streamed" value={t ? bytes(t.bytesDelivered) : 'ΓÇö'} delta={c?.bytesDelivered ?? undefined} period={PERIOD[range]} />
          </div>
        )}
      </section>
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

    </div>
  )
}
