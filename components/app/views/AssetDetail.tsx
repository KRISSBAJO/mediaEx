'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { PIPELINE, RETENTION, bytes, compact, dayLabel, duration as fmtDuration, getAsset, series } from '@/lib/sample'
import { LineChart, ViewToggle } from '../charts'
import Icon from '../Icon'
import { Card, StatusBadge, Tabs, Thumb, TypeIcon, copyText, toast } from '../ui'

type Tab = 'renditions' | 'captions' | 'analytics' | 'embed'

function tc(s: number) {
  const f = Math.floor((s % 1) * 24)
  const t = Math.floor(s)
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60, f].map((n) => String(n).padStart(2, '0')).join(':')
}

function Player({ id }: { id: string }) {
  const a = getAsset(id)!
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const len = a.duration || 30
  const raf = useRef(0)

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const tick = (now: number) => {
      setT((x) => {
        const n = x + (now - last) / 1000
        return n >= len ? 0 : n
      })
      last = now
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, len])

  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setT(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * len)
  }

  return (
    <div className={`player ${playing ? 'is-playing' : ''}`}>
      <Thumb asset={{ ...a, duration: 0 }} className="player-frame" />
      <span className="vf-corner tl" aria-hidden="true" />
      <span className="vf-corner tr" aria-hidden="true" />
      <span className="vf-corner bl" aria-hidden="true" />
      <span className="vf-corner br" aria-hidden="true" />
      <div className="player-meta" aria-hidden="true">
        <span>{a.type === 'video' ? `${a.resolution.replace(' × ', '×')} · AV1` : a.type === 'audio' ? 'Opus · 160 kbps' : 'AVIF · 6000 px'}</span>
        <span>{tc(t)}</span>
      </div>
      {a.type !== 'image' && (
        <>
          <button type="button" className="player-play" aria-label={playing ? 'Pause preview' : 'Play preview'} onClick={() => setPlaying((p) => !p)}>
            <Icon name={playing ? 'pause' : 'play'} size={22} />
          </button>
          <div className="player-bar">
            <div
              className="scrub"
              role="slider"
              tabIndex={0}
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(len)}
              aria-valuenow={Math.round(t)}
              aria-valuetext={`${fmtDuration(Math.round(t))} of ${fmtDuration(len)}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                seek(e)
              }}
              onPointerMove={(e) => e.buttons === 1 && seek(e)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') setT((x) => Math.min(len, x + 5))
                if (e.key === 'ArrowLeft') setT((x) => Math.max(0, x - 5))
              }}
            >
              <i style={{ width: `${(t / len) * 100}%` }} />
              <b style={{ left: `${(t / len) * 100}%` }} />
            </div>
            <span>
              {fmtDuration(Math.round(t)) === '—' ? '0:00' : fmtDuration(Math.round(t))} / {fmtDuration(len)}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function ladder(id: string) {
  const a = getAsset(id)!
  if (a.type === 'audio')
    return [
      ['Opus', '160 kbps', 'Stereo', a.duration * 20000],
      ['AAC-LC', '256 kbps', 'Stereo', a.duration * 32000],
      ['AAC-LC', '96 kbps', 'Stereo', a.duration * 12000],
    ] as const
  if (a.type === 'image')
    return [
      ['AVIF', '3840 px', 'q 62', 1.9e6 * 214],
      ['WebP', '1920 px', 'q 75', 0.6e6 * 214],
      ['JPEG', '640 px', 'q 80', 0.12e6 * 214],
    ] as const
  const four = a.resolution.startsWith('3840')
  const rows: [string, string, string, number][] = []
  ;(four ? [2160, 1440, 1080, 720, 480, 360] : [1080, 720, 480, 360]).forEach((h) => {
    const kbps = { 2160: 14000, 1440: 8000, 1080: 4500, 720: 2500, 480: 1100, 360: 600 }[h]!
    rows.push([h >= 1440 ? 'AV1' : 'AV1 + H.264', `${h}p`, `${(kbps / 1000).toFixed(1)} Mbps`, (a.duration * kbps * 1000) / 8])
  })
  return rows
}

const CAPTIONS = [
  { lang: 'English', code: 'EN', source: 'Auto · 98.6% confidence', status: 'ready' as const },
  { lang: 'Spanish', code: 'ES', source: 'Translated', status: 'ready' as const },
  { lang: 'Japanese', code: 'JA', source: 'Translated', status: 'ready' as const },
  { lang: 'French', code: 'FR', source: 'Translating', status: 'processing' as const },
]

export default function AssetDetail({ id }: { id: string }) {
  const a = getAsset(id)!
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(a.status === 'ready' ? 'analytics' : 'renditions')
  const [more, setMore] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [table, setTable] = useState(false)
  const playback = `https://play.mediaex.io/${a.id.slice(0, 4)}${a.thumb}f2c91e`
  const embed = `<iframe src="${playback}/embed" width="100%" style="aspect-ratio:16/9;border:0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
  const views = series(200 + a.thumb, 30, Math.max(40, a.views / 60), { trend: 0.01 })
  const stage = a.status === 'processing' ? Math.floor((a.progress / 100) * PIPELINE.length) : -1

  return (
    <>
      <Link href="/dashboard/library" className="back-link">
        <Icon name="arrowLeft" size={15} /> Library
      </Link>

      <div className="asset-head">
        <div>
          <h1>{a.title}</h1>
          <div className="asset-head-meta">
            <StatusBadge status={a.status} progress={a.progress} />
            <span>
              <TypeIcon type={a.type} />
              {a.type[0].toUpperCase() + a.type.slice(1)}
            </span>
            <span>{a.resolution}</span>
            {a.duration > 0 && <span>{fmtDuration(a.duration)}</span>}
            <span>{bytes(a.size)}</span>
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(playback, 'Playback URL copied')}>
            <Icon name="link" size={15} /> Copy link
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => copyText(`${playback}/review`, 'Review link copied — anyone with it can comment')}>
            Share for review
          </button>
          <div className="menu-wrap">
            <button type="button" className="icon-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              <Icon name="more" />
            </button>
            {more && (
              <div className="menu menu-right" role="menu" onMouseLeave={() => setMore(false)}>
                <button type="button" role="menuitem" onClick={() => (setMore(false), toast('Download links need the backend'))}>
                  <Icon name="file" size={15} /> Download original
                </button>
                <button type="button" role="menuitem" onClick={() => (setMore(false), toast(`Re-running the pipeline for “${a.title}”`))}>
                  <Icon name="refresh" size={15} /> Re-run pipeline
                </button>
                <hr />
                <button type="button" role="menuitem" className="is-danger" onClick={() => (setMore(false), setConfirm(true))}>
                  <Icon name="trash" size={15} /> Delete asset
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {a.status === 'failed' && (
        <div className="banner is-bad" role="alert">
          <Icon name="alert" />
          <div>
            <b>Packaging failed at 92%.</b> The source has a variable frame rate between 00:41:10 and 00:41:52, which HLS packaging rejects.
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => toast('Retrying with frame-rate conform enabled')}>
            Retry with conform
          </button>
        </div>
      )}

      <div className="asset-layout">
        <div className="stack">
          <Player id={a.id} />

          {a.status === 'processing' && (
            <Card title="Pipeline" meta={`${a.progress}% · about ${Math.max(1, Math.round((100 - a.progress) / 9))} min left`}>
              <div className="stages stages-lg">
                {PIPELINE.map((s, i) => (
                  <span key={s} className={i < stage ? 'is-done' : i === stage ? 'is-now' : ''}>
                    <i />
                    {s}
                  </span>
                ))}
              </div>
            </Card>
          )}

          <div>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'analytics', label: 'Analytics' },
                { value: 'renditions', label: 'Renditions', count: ladder(a.id).length },
                ...(a.type !== 'image' ? [{ value: 'captions' as Tab, label: 'Captions', count: CAPTIONS.length }] : []),
                { value: 'embed', label: 'Embed' },
              ]}
            />

            {tab === 'analytics' &&
              (a.views ? (
                <div className="stack">
                  <Card title="Views" meta="Last 30 days" action={<ViewToggle table={table} onChange={setTable} />}>
                    <LineChart points={views} label={`Daily views of ${a.title}, last 30 days`} height={220} table={table} yHead="Views" />
                  </Card>
                  {a.type !== 'image' && (
                    <Card title="Audience retention" meta="Share of viewers still watching">
                      <LineChart
                        points={RETENTION}
                        label="Audience retention across the asset"
                        height={200}
                        yMax={100}
                        format={(v) => `${v}% still watching`}
                        axisFormat={(v) => `${v}%`}
                        area={false}
                        table={table}
                        xHead="Position"
                        yHead="Still watching"
                      />
                    </Card>
                  )}
                </div>
              ) : (
                <Card>
                  <div className="empty">
                    <Icon name="analytics" size={22} />
                    <b>No views yet</b>
                    <p>Analytics appear as soon as the asset is ready and someone presses play.</p>
                  </div>
                </Card>
              ))}

            {tab === 'renditions' && (
              <Card flush>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Codec</th>
                        <th>{a.type === 'audio' ? 'Bitrate' : a.type === 'image' ? 'Width' : 'Resolution'}</th>
                        <th>{a.type === 'video' ? 'Bitrate' : 'Profile'}</th>
                        <th className="num">Size</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ladder(a.id).map((r, i) => (
                        <tr key={`${r[0]}-${r[1]}`}>
                          <td>{r[0]}</td>
                          <td className="mono">{r[1]}</td>
                          <td className="mono">{r[2]}</td>
                          <td className="num mono">{bytes(r[3])}</td>
                          <td>
                            <StatusBadge
                              status={a.status === 'ready' ? 'ready' : a.status === 'failed' ? (i === 0 ? 'failed' : 'ready') : i < 2 ? 'ready' : a.status === 'queued' ? 'queued' : 'processing'}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {tab === 'captions' && (
              <Card
                flush
                title="Caption tracks"
                action={
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => toast('Adding languages needs the backend')}>
                    <Icon name="plus" size={15} /> Add language
                  </button>
                }
              >
                <ul className="rows">
                  {CAPTIONS.map((c) => (
                    <li key={c.code}>
                      <span className="lang-code">{c.code}</span>
                      <div>
                        <b>{c.lang}</b>
                        <small>{c.source}</small>
                      </div>
                      <StatusBadge status={c.status} />
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {tab === 'embed' && (
              <div className="stack">
                <Card title="Playback URL" meta="HLS + DASH, adaptive">
                  <div className="copy-row">
                    <code>{playback}</code>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(playback, 'Playback URL copied')}>
                      <Icon name="copy" size={15} /> Copy
                    </button>
                  </div>
                </Card>
                <Card title="Embed code" meta="Responsive iframe">
                  <pre className="snippet">
                    <code>{embed}</code>
                  </pre>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(embed, 'Embed code copied')}>
                    <Icon name="copy" size={15} /> Copy embed code
                  </button>
                </Card>
              </div>
            )}
          </div>
        </div>

        <aside className="stack">
          <Card title="Details">
            <dl className="details">
              <div>
                <dt>Asset ID</dt>
                <dd className="mono">ast_{a.id.slice(0, 6)}{a.thumb}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{a.codec}</dd>
              </div>
              <div>
                <dt>Uploaded</dt>
                <dd>
                  {dayLabel(a.createdDaysAgo)} · Ada Okafor
                </dd>
              </div>
              <div>
                <dt>Views</dt>
                <dd>{a.views ? a.views.toLocaleString('en-US') : '—'}</dd>
              </div>
              <div>
                <dt>Watch time</dt>
                <dd>{a.watchHours ? `${compact(a.watchHours)} hours` : '—'}</dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>Public · signed URLs off</dd>
              </div>
            </dl>
          </Card>
          <Card title="Tags">
            <div className="tags">
              {a.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
              <button type="button" onClick={() => toast('Editing tags needs the backend')}>
                <Icon name="plus" size={13} /> Add
              </button>
            </div>
          </Card>
        </aside>
      </div>

      {confirm && (
        <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && setConfirm(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title">
            <h2 id="del-title">Delete “{a.title}”?</h2>
            <p>The original, every rendition and its caption tracks will be removed, and embeds will stop playing. This cannot be undone.</p>
            <div className="dialog-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)} autoFocus>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  setConfirm(false)
                  toast('Sample data can’t be deleted — this would remove the asset once the backend exists')
                  router.push('/dashboard/library')
                }}
              >
                Delete asset
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
