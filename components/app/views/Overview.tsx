'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ACTIVITY, ASSETS, COUNTRIES, PIPELINE, compact, metric, relDay, type Range } from '@/lib/sample'
import { useAccount } from '../account'
import { BarList, LineChart, ViewToggle } from '../charts'
import Icon from '../Icon'
import { Card, PageHead, RANGES, Segmented, StatTile, StatusBadge, Thumb, TypeIcon } from '../ui'

const PERIOD: Record<Range, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' }

/** a pretend live encoding queue: progress creeps forward so the page feels alive */
function useQueue() {
  const start = ASSETS.filter((a) => a.status === 'processing' || a.status === 'queued').map((a) => ({ ...a, p: a.status === 'queued' ? 0 : a.progress }))
  const [items, setItems] = useState(start)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => {
      setItems((xs) =>
        xs.map((x, i) => {
          if (x.status === 'queued' && i === xs.length - 1 && xs.every((o) => o === x || o.p > 60)) return { ...x, status: 'processing', p: 1 }
          if (x.status !== 'processing') return x
          const p = x.p >= 100 ? 100 : Math.min(100, x.p + Math.random() * 2.2)
          return { ...x, p, status: p >= 100 ? 'ready' : 'processing' }
        }),
      )
    }, 1200)
    return () => clearInterval(id)
  }, [])
  return items
}

export default function Overview() {
  const { user } = useAccount()
  const [range, setRange] = useState<Range>('30d')
  const [table, setTable] = useState(false)
  const views = metric(11, range, 21000, { trend: 0.006 })
  const watch = metric(12, range, 1400, { trend: 0.004 })
  const start = metric(13, range, 38, { trend: -0.001, noise: 0.06, weekly: 0.02 })
  const bandwidth = metric(14, range, 640, { trend: 0.005 })
  const avgStart = Math.round(start.total / start.points.length)
  const queue = useQueue()
  const recent = [...ASSETS].sort((a, b) => a.createdDaysAgo - b.createdDaysAgo).slice(0, 6)
  const top = ASSETS.filter((a) => a.views).sort((a, b) => b.views - a.views).slice(0, 5)
  const [greet, setGreet] = useState('Welcome back')
  useEffect(() => {
    const h = new Date().getHours()
    setGreet(h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening')
  }, [])

  return (
    <>
      <PageHead title={`${greet}, ${user.name.split(' ')[0]}`} sub="Here is how your media performed, and what the pipeline is working on.">
        <Segmented label="Date range" value={range} options={RANGES} onChange={setRange} />
      </PageHead>

      <div className="grid-ruled stat-tiles">
        <StatTile label="Views" value={compact(views.total)} delta={views.delta} points={views.points} period={PERIOD[range]} />
        <StatTile label="Watch time" value={compact(watch.total)} unit="hrs" delta={watch.delta} points={watch.points} period={PERIOD[range]} />
        <StatTile label="Avg. time to first frame" value={String(avgStart)} unit="ms" delta={start.delta} upIsGood={false} points={start.points} period={PERIOD[range]} />
        <StatTile label="Bandwidth delivered" value={(bandwidth.total / 1000).toFixed(1)} unit="TB" delta={bandwidth.delta} points={bandwidth.points} period={PERIOD[range]} />
      </div>

      <div className="grid-2">
        <div className="stack">
          <Card title="Views" meta={`Last ${PERIOD[range]}`} action={<ViewToggle table={table} onChange={setTable} />}>
            <div className="figure">
              <strong>{views.total.toLocaleString('en-US')}</strong>
              <span className={views.delta >= 0 ? 'is-good' : 'is-bad'}>
                {views.delta >= 0 ? '↑' : '↓'} {Math.abs(views.delta * 100).toFixed(1)}% vs previous {PERIOD[range]}
              </span>
            </div>
            <LineChart points={views.points} label={`Daily views, last ${PERIOD[range]}`} table={table} yHead="Views" />
          </Card>

          <Card
            title="Recent uploads"
            flush
            action={
              <Link href="/dashboard/library" className="panel-link">
                View library <Icon name="arrowRight" size={14} />
              </Link>
            }
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Status</th>
                    <th className="num">Views</th>
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
                              {a.resolution}
                            </small>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={a.status} progress={a.progress} />
                      </td>
                      <td className="num">{a.views ? compact(a.views) : '—'}</td>
                      <td className="num muted">{relDay(a.createdDaysAgo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card
            title="Pipeline"
            meta={`${queue.filter((q) => q.status !== 'ready').length} jobs`}
            action={
              <span className="live-tag">
                <i />
                Live
              </span>
            }
          >
            <ul className="queue">
              {queue.map((q) => {
                const stage = q.status === 'queued' ? -1 : Math.min(PIPELINE.length - 1, Math.floor((q.p / 100) * PIPELINE.length))
                return (
                  <li key={q.id}>
                    <div className="queue-top">
                      <Link href={`/dashboard/library/${q.id}`}>{q.title}</Link>
                      <StatusBadge status={q.status} progress={q.status === 'processing' ? Math.round(q.p) : undefined} />
                    </div>
                    <div className="stages" aria-label={q.status === 'queued' ? 'Waiting to start' : `Stage: ${PIPELINE[stage]}`}>
                      {PIPELINE.map((s, i) => (
                        <span key={s} className={q.status === 'ready' || i < stage ? 'is-done' : i === stage ? 'is-now' : ''}>
                          <i />
                          {s}
                        </span>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card title="Top assets" meta="By views, all time">
            <BarList points={top.map((a) => ({ label: a.title, value: a.views }))} format={compact} />
          </Card>

          <Card title="Top countries" meta={`Last ${PERIOD[range]}`}>
            <BarList points={COUNTRIES.slice(0, 5)} format={compact} />
          </Card>

          <Card title="Activity">
            <ul className="activity">
              {ACTIVITY.map((a, i) => (
                <li key={i}>
                  <span className={`act-dot ${a.what.startsWith('failed') ? 'is-bad' : ''}`} />
                  <p>
                    <b>{a.who}</b> {a.what} {a.target && <em>{a.target}</em>}
                  </p>
                  <time>{a.when}</time>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}
