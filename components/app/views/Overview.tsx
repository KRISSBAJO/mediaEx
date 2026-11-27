'use client'

import Link from 'next/link'
import { useState } from 'react'
import { STAGES, isActive, type MediaAsset } from '@/lib/media/types'
import { bytes, compact, type Range } from '@/lib/sample'
import { countryName, useAnalytics } from './Analytics'

import { Ago, useMedia } from '../media'
import { BarList, LineChart, ViewToggle } from '../charts'
import Icon from '../Icon'
import { Card, PageHead, RANGES, Segmented, StatTile, StatusBadge, Thumb, TypeIcon } from '../ui'

const PERIOD: Record<Range, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' }

/** recent things that happened to the workspace's media, newest first */
function activity(assets: MediaAsset[]) {
  const out: { at: string; who: string; what: string; target: string; id: string; bad?: boolean }[] = []
  for (const a of assets) {
    out.push({ at: a.createdAt, who: a.createdBy ?? 'Someone', what: 'uploaded', target: a.title, id: a.id })
    if (a.readyAt) out.push({ at: a.readyAt, who: 'Pipeline', what: 'finished', target: a.title, id: a.id })
    if (a.status === 'failed') out.push({ at: a.createdAt, who: 'Pipeline', what: 'failed on', target: a.title, id: a.id, bad: true })
  }
  return out.sort((x, y) => y.at.localeCompare(x.at)).slice(0, 6)
}

export default function Overview() {

  const [range, setRange] = useState<Range>('30d')
  const [table, setTable] = useState(false)
  const { data, error } = useAnalytics(range)
  const t = data?.totals
  const c = data?.change
  const daily = data?.daily ?? []
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const { assets, summary } = useMedia()
  const queue = assets.filter(isActive).slice(0, 5)
  const recent = assets.slice(0, 6)
  const byType = (['video', 'audio', 'image'] as const).map((t) => ({ label: t === 'video' ? 'Video' : t === 'audio' ? 'Audio' : 'Images', value: summary[t] }))
  const stored = summary.bytes

  return (
    <>
      <PageHead title="Workspace overview" sub="Track uploads, processing, and audience activity.">
        <Segmented label="Date range" value={range} options={RANGES} onChange={setRange} />
      </PageHead>

      <section aria-labelledby="overview-audience"><div className="overview-section-head">
        <h2 id="overview-audience">Audience</h2><p>Views through share links and embeds</p>
      </div>
      {error && (
        <div className="banner is-bad" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      <div className="grid-ruled stat-tiles">
        <StatTile label="Views" value={t ? compact(t.views) : '—'} delta={c?.views ?? undefined} points={daily.map((d) => ({ label: d.date, value: d.views }))} period={PERIOD[range]} />
        <StatTile label="Watch time" value={t ? (t.watchHours >= 100 ? compact(Math.round(t.watchHours)) : t.watchHours.toFixed(1)) : '—'} unit="hrs" delta={c?.watchHours ?? undefined} points={daily.map((d) => ({ label: d.date, value: d.watchHours }))} period={PERIOD[range]} />
        <StatTile label="Avg. time to first frame" value={t?.avgStartupMs != null ? t.avgStartupMs.toLocaleString('en-US') : '—'} unit="ms" delta={c?.avgStartupMs ?? undefined} upIsGood={false} period={PERIOD[range]} />
        <StatTile label="Streamed" value={t ? bytes(t.bytesDelivered) : '—'} delta={c?.bytesDelivered ?? undefined} period={PERIOD[range]} />
      </div>

      </section>

      <div className="grid-2">
        <div className="stack">
          <Card
            title="Recent uploads"
            meta={`${summary.total} in library`}
            flush
            action={
              <Link href="/dashboard/library" className="panel-link">
                View library <Icon name="arrowRight" size={14} />
              </Link>
            }
          >
            {recent.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Status</th>
                      <th className="num">Size</th>
                      <th className="num">Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/dashboard/library/${a.id}`} className="asset-cell">
                            <Thumb asset={a} />
                            <span>
                              <b>{a.title}</b>
                              <small>
                                <TypeIcon type={a.type} />
                                {a.sourceInfo ?? a.fileName}
                              </small>
                            </span>
                          </Link>
                        </td>
                        <td>
                          <StatusBadge status={a.status} progress={a.progress} />
                        </td>
                        <td className="num">{bytes(a.size)}</td>
                        <td className="num muted">
                          <Ago iso={a.createdAt} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <Icon name="upload" size={22} />
                <b>Nothing uploaded yet</b>
                <p>Your first upload shows up here while it encodes.</p>
                <Link href="/dashboard/uploads" className="btn btn-primary btn-sm">
                  Upload files
                </Link>
              </div>
            )}
          </Card>

          <Card
            title="Views"
            meta={`Last ${PERIOD[range]}`}
            action={
              <>
                <Link href="/dashboard/analytics" className="panel-link">
                  Analytics <Icon name="arrowRight" size={14} />
                </Link>
                <ViewToggle table={table} onChange={setTable} />
              </>
            }
          >
            <div className="figure">
              <strong>{t ? t.views.toLocaleString('en-US') : '—'}</strong>
              {c?.views != null && (
                <span className={c.views >= 0 ? 'is-good' : 'is-bad'}>
                  {c.views >= 0 ? '↑' : '↓'} {Math.abs(c.views * 100).toFixed(1)}% vs previous {PERIOD[range]}
                </span>
              )}
            </div>
            <LineChart points={daily.map((d) => ({ label: day(d.date), value: d.views }))} label={`Daily views, last ${PERIOD[range]}`} table={table} yHead="Views" />
          </Card>
        </div>

        <div className="stack">
          <Card
            title="Pipeline"
            meta={queue.length ? `${queue.length} ${queue.length === 1 ? 'job' : 'jobs'}` : 'Idle'}
            action={
              queue.length ? (
                <span className="live-tag">
                  <i />
                  Live
                </span>
              ) : undefined
            }
          >
            {queue.length ? (
              <ul className="queue">
                {queue.map((q) => {
                  const now = q.status === 'uploading' ? 0 : q.status === 'queued' ? -1 : q.stage
                  return (
                    <li key={q.id}>
                      <div className="queue-top">
                        <Link href={`/dashboard/library/${q.id}`}>{q.title}</Link>
                        <StatusBadge status={q.status} progress={q.progress} />
                      </div>
                      <div className="stages stages-4" aria-label={q.status === 'queued' ? 'Waiting to start' : `Stage: ${STAGES[Math.max(0, now)]}`}>
                        {STAGES.map((s, i) => (
                          <span key={s} className={(q.status === 'queued' ? i === 0 : i < now) ? 'is-done' : i === now ? 'is-now' : ''}>
                            <i />
                            {s}
                          </span>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="quiet-note">Nothing is encoding right now. New uploads appear here as they move through the pipeline.</p>
            )}
          </Card>

          <Card title="Library" meta={`${bytes(stored)} stored`}>
            <BarList points={byType} format={(v) => String(v)} max={Math.max(1, summary.total)} />
          </Card>

          <Card title="Activity">
            {assets.length ? (
              <ul className="activity">
                {activity(assets).map((e, i) => (
                  <li key={i}>
                    <span className={`act-dot ${e.bad ? 'is-bad' : ''}`} />
                    <p>
                      <b>{e.who}</b> {e.what}{' '}
                      <Link href={`/dashboard/library/${e.id}`}>
                        <em>{e.target}</em>
                      </Link>
                    </p>
                    <Ago iso={e.at} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet-note">Uploads, finished encodes and failures show up here.</p>
            )}
          </Card>

          <Card title="Top countries" meta={`Views · last ${PERIOD[range]}`}>
            {data?.countries.length ? (
              <BarList points={data.countries.slice(0, 5).map((r) => ({ label: countryName(r.country), value: r.views }))} format={compact} />
            ) : data ? (
              <p className="quiet-note">No views yet. Share a link or embed a player to see where your audience is.</p>
            ) : <p className="quiet-note">{error ? 'Country data unavailable.' : 'Loading country data…'}</p>}
          </Card>
        </div>
      </div>
    </>
  )
}
