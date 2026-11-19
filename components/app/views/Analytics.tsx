'use client'

import { useState } from 'react'
import { COUNTRIES, DEVICES, HOURS, REGIONS, RETENTION, compact, metric, type Range } from '@/lib/sample'
import { BarList, ColumnChart, LineChart, ViewToggle } from '../charts'
import Icon from '../Icon'
import { Card, PageHead, RANGES, Segmented, StatTile } from '../ui'

const PERIOD: Record<Range, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' }

function quality(v: number, warn: number, bad: number) {
  return v >= bad ? 'is-bad' : v >= warn ? 'is-warn' : 'is-good'
}
const QLABEL = { 'is-good': 'Healthy', 'is-warn': 'Watch', 'is-bad': 'Degraded' }

export default function Analytics() {
  const [range, setRange] = useState<Range>('30d')
  const [asset, setAsset] = useState('all')
  const [table, setTable] = useState(false)
  const scale = asset === 'all' ? 1 : 0.18
  const views = metric(21, range, 21000 * scale, { trend: 0.006 })
  const uniques = metric(22, range, 12400 * scale, { trend: 0.005 })
  const watch = metric(23, range, 1400 * scale, { trend: 0.004 })
  const rebuffer = metric(24, range, 31, { trend: -0.002, noise: 0.1, weekly: 0.05 })
  const avgView = Math.round((watch.total * 3600) / Math.max(1, views.total)) // seconds per view
  const peak = HOURS.reduce((m, p, i) => (p.value > HOURS[m].value ? i : m), 0)
  // hours and countries are shares of the same view total, so every panel agrees
  const share = (pts: typeof HOURS) => {
    const sum = pts.reduce((t, p) => t + p.value, 0)
    return pts.map((p) => ({ ...p, value: Math.round((p.value / sum) * views.total) }))
  }

  return (
    <>
      <PageHead title="Analytics" sub="Audience and quality of experience across every asset and region." />

      <div className="filters">
        <Segmented label="Date range" value={range} options={RANGES} onChange={setRange} />
        <label>
          <span className="sr-only">Asset</span>
          <select className="select" value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="all">All assets</option>
            <option value="launch-film-final-cut">Launch film — final cut</option>
            <option value="keynote-2026-full-session">Keynote 2026 — full session</option>
            <option value="trailer-nightjar">Trailer — Nightjar</option>
          </select>
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTable((t) => !t)}>
          <Icon name={table ? 'analytics' : 'list'} size={15} /> {table ? 'Show charts' : 'Show tables'}
        </button>
      </div>

      <div className="grid-ruled stat-tiles">
        <StatTile label="Views" value={compact(views.total)} delta={views.delta} points={views.points} period={PERIOD[range]} />
        <StatTile label="Unique viewers" value={compact(uniques.total)} delta={uniques.delta} points={uniques.points} period={PERIOD[range]} />
        <StatTile label="Avg. view duration" value={`${Math.floor(avgView / 60)}:${String(avgView % 60).padStart(2, '0')}`} unit="min" delta={watch.delta - views.delta} period={PERIOD[range]} />
        <StatTile
          label="Rebuffer ratio"
          value={(rebuffer.total / rebuffer.points.length / 100).toFixed(2)}
          unit="%"
          delta={rebuffer.delta}
          upIsGood={false}
          points={rebuffer.points}
          period={PERIOD[range]}
        />
      </div>

      <div className="stack">
        <Card title="Views" meta={`Daily, last ${PERIOD[range]}`} action={<ViewToggle table={table} onChange={setTable} />}>
          <LineChart points={views.points} label={`Daily views, last ${PERIOD[range]}`} height={260} table={table} yHead="Views" />
        </Card>

        <div className="grid-2 even">
          <Card title="When people watch" meta={`Views by hour · peak ${HOURS[peak].label}`}>
            <ColumnChart
              points={share(HOURS)}
              label="Views by hour of day, viewer local time"
              highlight={peak}
              table={table}
              xHead="Hour"
              yHead="Views"
            />
          </Card>
          <Card title="Audience retention" meta="Average across assets">
            <LineChart
              points={RETENTION}
              label="Share of viewers still watching across an average asset"
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
            <BarList points={share(COUNTRIES)} format={compact} />
          </Card>
          <Card title="Devices" meta="Share of watch time">
            <BarList points={DEVICES} format={(v) => `${v.toFixed(1)}%`} max={100} />
          </Card>
        </div>

        <Card title="Delivery quality by region" meta={`Last ${PERIOD[range]}`} flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Region</th>
                  <th>Edge locations</th>
                  <th className="num">Time to first frame</th>
                  <th className="num">Rebuffer ratio</th>
                  <th className="num">Error rate</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                {REGIONS.map((r) => {
                  const worst = [quality(r.startMs, 45, 55), quality(r.rebuffer, 0.4, 0.6), quality(r.errors, 0.03, 0.05)].sort()
                  const h = worst.includes('is-bad') ? 'is-bad' : worst.includes('is-warn') ? 'is-warn' : 'is-good'
                  return (
                    <tr key={r.region}>
                      <td>{r.region}</td>
                      <td className="mono">{r.pop}</td>
                      <td className="num">{r.startMs} ms</td>
                      <td className="num">{r.rebuffer.toFixed(2)}%</td>
                      <td className="num">{r.errors.toFixed(2)}%</td>
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
    </>
  )
}

