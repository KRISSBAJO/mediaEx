'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { AnalyticsRange, AnalyticsReport } from '@/lib/media/types'
import { bytes, compact } from '@/lib/sample'
import { BarList, ColumnChart, LineChart, ViewToggle } from '../charts'
import Icon from '../Icon'
import { useMedia } from '../media'
import { Card, PageHead, RANGES, Segmented, StatTile } from '../ui'

const PERIOD: Record<AnalyticsRange, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' }

/** The report for a range (and optionally one asset), refetched when either changes. */
export function useAnalytics(range: AnalyticsRange, asset = '') {
  const params = new URLSearchParams({ range })
  if (asset) params.set('asset', asset)
  const url = `/api/analytics?${params}`
  const [result, setResult] = useState<{ url: string; data: AnalyticsReport | null; error: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null)
          throw new Error(body?.error || `Couldn't load analytics (${r.status}).`)
        }
        const data: AnalyticsReport = await r.json()
        if (!controller.signal.aborted) setResult({ url, data, error: '' })
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setResult({ url, data: null, error: e.message })
      })
    return () => controller.abort()
  }, [url])
  return result?.url === url ? result : { data: null, error: '' }
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const regions = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null
export const countryName = (c: string | null) => (c ? (regions?.of(c) ?? c) : 'Unknown')
export function mmss(seconds: number) {
  const rounded = Math.round(seconds)
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`
}
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`
export const watchTime = (h: number) => (h >= 1 ? `${h.toFixed(1)} h` : h * 60 >= 1 ? `${Math.round(h * 60)} min` : `${Math.round(h * 3600)} s`)

function quality(v: number, warn: number, bad: number) {
  return v >= bad ? 'is-bad' : v >= warn ? 'is-warn' : 'is-good'
}
const QLABEL = { 'is-good': 'Healthy', 'is-warn': 'Watch', 'is-bad': 'Degraded' }

export default function Analytics() {
  const params = useSearchParams()
  const { assets } = useMedia()
  const [range, setRange] = useState<AnalyticsRange>('30d')
  const [asset, setAsset] = useState(params.get('asset') ?? '')
  const [table, setTable] = useState(false)
  const { data, error } = useAnalytics(range, asset)
  const playable = assets.filter((a) => a.status === 'ready' && a.type !== 'image')
  const t = data?.totals
  const c = data?.change
  const daily = data?.daily ?? []
  const peak = data ? data.hours.reduce((m, h) => (h.views > data.hours[m].views ? h.hour : m), 0) : 0
  const empty = data && data.totals.views === 0

  return (
    <>
      <PageHead title="Analytics" sub="Who watched, for how long, and how smoothly. Counted from MediaEX share links and embeds." />

      <div className="filters">
        <Segmented label="Date range" value={range} options={RANGES} onChange={setRange} />
        <label>
          <span className="sr-only">Asset</span>
          <select className="select" value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="">All assets</option>
            {playable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-ghost" onClick={() => setTable((x) => !x)}>
          <Icon name={table ? 'analytics' : 'list'} size={15} /> {table ? 'Show charts' : 'Show tables'}
        </button>
      </div>

      {error && (
        <div className="banner is-bad" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}

      <div className="grid-ruled stat-tiles">
        <StatTile label="Views" value={t ? compact(t.views) : '—'} delta={c?.views ?? undefined} points={daily.map((d) => ({ label: d.date, value: d.views }))} period={PERIOD[range]} />
        <StatTile label="Unique viewers" value={t ? compact(t.uniqueViewers) : '—'} delta={c?.uniqueViewers ?? undefined} points={daily.map((d) => ({ label: d.date, value: d.viewers }))} period={PERIOD[range]} />
        <StatTile label="Avg. view duration" value={t ? mmss(t.avgViewSeconds) : '—'} unit="min" delta={c?.avgViewSeconds ?? undefined} period={PERIOD[range]} />
        <StatTile label="Rebuffer ratio" value={t ? (t.rebufferRatio * 100).toFixed(2) : '—'} unit="%" delta={c?.rebufferRatio ?? undefined} upIsGood={false} period={PERIOD[range]} />
      </div>

      {!data && !error && <p className="quiet-note" role="status">Loading analytics…</p>}
      {data && (empty ? (
        <Card>
          <div className="empty">
            <Icon name="analytics" size={22} />
            <b>
              No views in the last {PERIOD[range]}
              {asset ? ' for this asset' : ''}
            </b>
            <p>Views are counted when someone watches through a share link or an embed. Previews in this dashboard don’t count, and neither do other players on the raw stream URL.</p>
            <Link href="/dashboard/library" className="btn btn-ghost btn-sm">
              Get a share link
            </Link>
          </div>
        </Card>
      ) : (
        <div className="stack">
          <Card title="Views" meta={`Daily, last ${PERIOD[range]}${t ? ` · ${watchTime(t.watchHours)} watched` : ''}`} action={<ViewToggle table={table} onChange={setTable} />}>
            <LineChart points={daily.map((d) => ({ label: day(d.date), value: d.views }))} label={`Daily views, last ${PERIOD[range]}`} height={260} table={table} yHead="Views" />
          </Card>

          <div className="grid-2 even">
            <Card title="When people watch" meta={data ? `Views by hour · peak ${String(peak).padStart(2, '0')}:00` : 'Views by hour'}>
              <ColumnChart
                points={(data?.hours ?? []).map((h) => ({ label: `${String(h.hour).padStart(2, '0')}:00`, value: h.views }))}
                label="Views by hour of day, viewer local time"
                highlight={peak}
                table={table}
                xHead="Hour"
                yHead="Views"
              />
            </Card>
            <Card title="Audience retention" meta={t ? `${pct(t.completionRate, 0)} watch to the end` : 'Share still watching'}>
              <LineChart
                points={(data?.retention ?? []).map((r) => ({ label: `${r.position}%`, value: r.share }))}
                label="Share of views still watching at each point of the asset"
                height={220}
                yMax={100}
                area={false}
                format={(v) => `${v}% still watching`}
                axisFormat={(v) => `${v}%`}
                table={table}
                xHead="Position"
                yHead="Still watching"
              />
            </Card>
          </div>

          <div className="grid-2 even">
            <Card title="Top countries" meta="Views">
              <BarList points={(data?.countries ?? []).map((r) => ({ label: countryName(r.country), value: r.views }))} format={compact} />
            </Card>
            <Card title="Devices" meta="Share of watch time">
              <BarList points={(data?.devices ?? []).map((r) => ({ label: r.device, value: r.share }))} format={(v) => `${v.toFixed(1)}%`} max={100} />
            </Card>
          </div>

          <div className="grid-2 even">
            <Card title="Top assets" meta="By views" flush>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th className="num">Views</th>
                      <th className="num">Watch time</th>
                      <th className="num">Finished</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.topAssets ?? []).map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/dashboard/library/${a.id}`} className="cell-strong">
                            {a.title}
                          </Link>
                        </td>
                        <td className="num">{a.views.toLocaleString('en-US')}</td>
                        <td className="num">{watchTime(a.watchHours)}</td>
                        <td className="num">{pct(a.completionRate, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Where views come from" meta={t ? `${bytes(t.bytesDelivered)} streamed` : 'Referring sites'}>
              <BarList points={(data?.sources ?? []).map((r) => ({ label: r.referrer ?? 'Direct or share link', value: r.views }))} format={compact} />
            </Card>
          </div>

          <Card title="Quality of experience by country" meta={`Last ${PERIOD[range]}`} flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Country</th>
                    <th className="num">Views</th>
                    <th className="num">Time to first frame</th>
                    <th className="num">Rebuffer ratio</th>
                    <th className="num">Error rate</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.quality ?? []).map((r) => {
                    const marks = [quality(r.avgStartupMs ?? 0, 1500, 3000), quality(r.rebufferRatio * 100, 0.5, 2), quality(r.errorRate * 100, 1, 3)]
                    const h = marks.includes('is-bad') ? 'is-bad' : marks.includes('is-warn') ? 'is-warn' : 'is-good'
                    return (
                      <tr key={r.country ?? 'unknown'}>
                        <td>{countryName(r.country)}</td>
                        <td className="num">{r.views.toLocaleString('en-US')}</td>
                        <td className="num">{r.avgStartupMs === null ? '—' : `${r.avgStartupMs.toLocaleString('en-US')} ms`}</td>
                        <td className="num">{(r.rebufferRatio * 100).toFixed(2)}%</td>
                        <td className="num">{(r.errorRate * 100).toFixed(2)}%</td>
                        <td>
                          <span className={`dot-status ${h}`}>{QLABEL[h]}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ))}
    </>
  )
}
