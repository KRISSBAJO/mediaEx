'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The Platform section: one file's journey through MediaEX, one stage at a time.
 * Auto-advances while in view (pauses on hover/focus, never with reduced motion); every step is also a tab.
 * Everything shown here is something the product really does (see backend/media/*).
 */
const STEPS = [
  {
    key: 'upload',
    label: 'Upload',
    title: 'Straight into your bucket',
    body: 'Drop any video, audio or image. It goes directly to S3-compatible storage — R2, S3, MinIO — not through our servers.',
    status: 'Uploading',
  },
  {
    key: 'encode',
    label: 'Encode',
    title: 'A streaming ladder, built for you',
    body: 'FFmpeg cuts an adaptive HLS ladder from 1080p down to 360p, with a poster, thumbnails and audio waveforms.',
    status: 'Encoding',
  },
  {
    key: 'transform',
    label: 'Transform',
    title: 'Every size, from the URL',
    body: 'Resize, smart-crop, watermark and convert to AVIF or WebP with query parameters. Rendered once, then cached.',
    status: 'Ready',
  },
  {
    key: 'organise',
    label: 'Organise',
    title: 'Found in a keystroke',
    body: 'Folders, collections, tags and your own metadata fields — searchable, filterable, saved as views.',
    status: 'Ready',
  },
  {
    key: 'review',
    label: 'Review',
    title: 'Nothing goes public unchecked',
    body: 'Hold uploads for approval. A blocklist and Claude flag anything a person should look at first.',
    status: 'In review',
  },
  {
    key: 'ship',
    label: 'Ship',
    title: 'Stream it, script it, hear about it',
    body: 'A player for every link, a REST API with scoped keys, and signed webhooks the moment anything changes.',
    status: 'Live',
  },
] as const

type Key = (typeof STEPS)[number]['key']
const STEP_MS = 6500

export default function Pipeline() {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  const [reduce, setReduce] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const step = STEPS[i]
  const running = visible && !paused && !reduce

  useEffect(() => {
    setReduce(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 })
    if (root.current) io.observe(root.current)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!running) return
    const t = setTimeout(() => setI((n) => (n + 1) % STEPS.length), STEP_MS)
    return () => clearTimeout(t)
  }, [running, i])
  // on phones the rail is a scrolling row of tabs: keep the active one in view (without scrolling the page)
  useEffect(() => {
    const r = rail.current
    const tab = r?.children[i] as HTMLElement | undefined
    if (r && tab && r.scrollWidth > r.clientWidth) r.scrollTo({ left: tab.offsetLeft - 8, behavior: reduce ? 'auto' : 'smooth' })
  }, [i, reduce])

  // the reveal class is added by MotionRoot; it lives on a wrapper whose className React never rewrites
  return (
    <div data-reveal>
      <div
        ref={root}
        className={`pipe ${running ? 'is-running' : ''}`}
        style={{ ['--step-ms' as string]: `${STEP_MS}ms` }}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <div ref={rail} className="pipe-steps" role="tablist" aria-label="The MediaEX pipeline">
          {STEPS.map((s, n) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              id={`pipe-tab-${s.key}`}
              aria-selected={n === i}
              aria-controls="pipe-stage"
              className={`pipe-step ${n === i ? 'is-on' : ''} ${n < i ? 'is-done' : ''}`}
              onClick={() => setI(n)}
            >
              <span className="pipe-num">{String(n + 1).padStart(2, '0')}</span>
              <span className="pipe-label">{s.label}</span>
              <span className="pipe-copy">
                <span>
                  <b>{s.title}</b>
                  <span>{s.body}</span>
                </span>
              </span>
              <i className="pipe-progress" key={n === i ? `p${i}` : undefined} />
            </button>
          ))}
        </div>

        <div className="pipe-stage" id="pipe-stage" role="tabpanel" aria-labelledby={`pipe-tab-${step.key}`}>
          <div className="pipe-bar" aria-hidden="true">
            <span className="pipe-file">
              <i className="pipe-file-ico" />
              harbour_sunset.mov
            </span>
            <span className={`pipe-status s-${step.key}`} key={step.key}>
              <i />
              {step.status}
            </span>
          </div>
          <div className="pipe-view" key={step.key} aria-hidden="true">
            <Stage k={step.key} />
          </div>
          <div className="pipe-caption" key={`c-${step.key}`}>
            <b>{step.title}</b>
            <p>{step.body}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------ the shared picture: a dusk harbour, drawn in CSS */
function Scene({ className = '' }: { className?: string }) {
  return (
    <div className={`scene ${className}`}>
      <i className="scene-sun" />
      <i className="scene-sea" />
      <i className="scene-boat" />
    </div>
  )
}

function Stage({ k }: { k: Key }) {
  if (k === 'upload')
    return (
      <div className="st-upload">
        <div className="drop">
          <div className="drop-card">
            <Scene className="is-thumb" />
            <div>
              <b>harbour_sunset.mov</b>
              <span className="mono">2.4 GB · ProRes 422 · 4K</span>
              <div className="drop-bar">
                <i />
              </div>
            </div>
          </div>
          <div className="chunks">
            {Array.from({ length: 24 }, (_, n) => (
              <i key={n} style={{ ['--n' as string]: n }} />
            ))}
          </div>
          <div className="drop-foot">
            <span className="mono">PUT → r2://studio-media/org_7f/ast_k2…/original.mov</span>
            <span>Direct to bucket</span>
          </div>
        </div>
      </div>
    )

  if (k === 'encode')
    return (
      <div className="st-encode">
        <Scene className="is-wide" />
        <ul className="ladder">
          {[
            ['1080p', '5.0 Mb/s', 100],
            ['720p', '2.8 Mb/s', 72],
            ['480p', '1.4 Mb/s', 50],
            ['360p', '0.8 Mb/s', 34],
            ['Audio', 'AAC 128k', 18],
          ].map(([name, rate, w], n) => (
            <li key={name} style={{ ['--n' as string]: n, ['--w' as string]: `${w}%` }}>
              <span>{name}</span>
              <div>
                <i />
              </div>
              <em className="mono">{rate}</em>
              <b aria-hidden="true">✓</b>
            </li>
          ))}
        </ul>
        <div className="outs">
          {['master.m3u8', 'poster.jpg', 'thumb.jpg'].map((o, n) => (
            <span key={o} className="mono" style={{ ['--n' as string]: n }}>
              {o}
            </span>
          ))}
        </div>
      </div>
    )

  if (k === 'transform')
    return (
      <div className="st-transform">
        <div className="url mono">
          <span className="url-base">/media/ast_k2…/transform?</span>
          <span className="url-p p1">w=1200</span>
          <span className="url-amp">&amp;</span>
          <span className="url-p p2">fit=cover</span>
          <span className="url-amp">&amp;</span>
          <span className="url-p p3">pos=attention</span>
          <span className="url-amp">&amp;</span>
          <span className="url-p p4">f=avif</span>
        </div>
        <div className="crops">
          <figure className="crop c-wide">
            <Scene />
            <figcaption className="mono">16:9 · AVIF · 92 KB</figcaption>
          </figure>
          <figure className="crop c-square">
            <Scene />
            <figcaption className="mono">1:1 · WebP</figcaption>
          </figure>
          <figure className="crop c-tall">
            <Scene />
            <figcaption className="mono">9:16 · AVIF</figcaption>
          </figure>
        </div>
        <span className="cache-note">
          <i /> Cached after the first request
        </span>
      </div>
    )

  if (k === 'organise')
    return (
      <div className="st-organise">
        <div className="search">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="typed">sunset</span>
          <span className="chips">
            <em>Video</em>
            <em>Client: Northwind</em>
          </span>
        </div>
        <div className="lib">
          {['match', 'dim', 'match', 'dim', 'dim', 'match', 'dim', 'dim'].map((m, n) => (
            <div key={n} className={`lib-item is-${m}`} style={{ ['--n' as string]: n }}>
              <Scene className={`v${n % 4}`} />
            </div>
          ))}
        </div>
        <div className="meta">
          {[
            ['Folder', 'Campaigns / Spring'],
            ['Tags', 'harbour · golden-hour'],
            ['Licence', 'Editorial'],
          ].map(([k2, v], n) => (
            <div key={k2} style={{ ['--n' as string]: n }}>
              <span>{k2}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      </div>
    )

  if (k === 'review')
    return (
      <div className="st-review">
        <div className="scan">
          <Scene className="is-wide" />
          <i className="scan-line" />
          {[18, 50, 82].map((x, n) => (
            <span key={x} className="scan-frame" style={{ left: `${x}%`, ['--n' as string]: n }} />
          ))}
        </div>
        <ul className="checks">
          {[
            ['Blocklist', 'No matches in title, tags or fields'],
            ['Claude review', '3 frames checked · nothing flagged'],
            ['Decision', 'Approved by Ada · 12:04'],
          ].map(([a, b], n) => (
            <li key={a} style={{ ['--n' as string]: n }}>
              <i />
              <span>
                <b>{a}</b>
                {b}
              </span>
            </li>
          ))}
        </ul>
        <span className="stamp">Approved</span>
      </div>
    )

  return (
    <div className="st-ship">
      <div className="player">
        <Scene className="is-wide" />
        <span className="q mono">
          <i>360p</i>
          <i>720p</i>
          <i>1080p</i>
        </span>
        <div className="player-bar">
          <span className="play" />
          <div>
            <i />
          </div>
          <span className="mono">00:42</span>
        </div>
      </div>
      <div className="log mono">
        {[
          ['POST', '/api/v1/uploads', '201', '38 ms'],
          ['hook', 'asset.ready → api.northwind.app', '200', '84 ms'],
          ['GET', '/api/v1/assets?q=sunset', '200', '21 ms'],
          ['hook', 'asset.approved → api.northwind.app', '200', '79 ms'],
        ].map(([m, p, s, t], n) => (
          <div key={p} style={{ ['--n' as string]: n }}>
            <span className={m === 'hook' ? 'is-hook' : ''}>{m}</span>
            <span>{p}</span>
            <b>{s}</b>
            <em>{t}</em>
          </div>
        ))}
      </div>
    </div>
  )
}
