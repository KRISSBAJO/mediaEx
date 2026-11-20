'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import HeroScene, { type ReelControl } from './HeroScene'
import Timecode from './Timecode'

/**
 * The hero viewfinder, and what it does when you press play: the glass play button spins away and a 20-second tour
 * runs in its place, one chapter per step of the pipeline (upload, encode, captions, deliver, watch), then the
 * button comes back. Anything with data-play-tour on the page (the "Watch the film" link) starts it too.
 * Every chapter shows something MediaEX really does; the numbers are a worked example.
 */
const CHAPTERS = [
  { key: 'upload', name: 'Upload', meta: 'Resumable · 16 MiB parts' },
  { key: 'encode', name: 'Encode', meta: 'H.264 · HEVC · AV1' },
  { key: 'captions', name: 'Captions', meta: 'Speech to WebVTT' },
  { key: 'deliver', name: 'Deliver', meta: 'One URL · every screen' },
  { key: 'watch', name: 'Watch', meta: 'Signed links · live analytics' },
] as const
const CHAPTER_MS = 4000
const AWAY_MS = 650 // the prism's exit before the first chapter

/** Counts up to `to` over `ms` once mounted. */
function Count({ to, ms = 1400, delay = 0, format = (n: number) => Math.round(n).toLocaleString('en-US') }: { to: number; ms?: number; delay?: number; format?: (n: number) => string }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setV(to)
    let raf = 0
    const start = performance.now() + delay
    const tick = (now: number) => {
      const p = Math.min(Math.max((now - start) / ms, 0), 1)
      setV(to * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, ms, delay])
  return <>{format(v)}</>
}

const d = (s: number) => ({ ['--d' as string]: `${s}s` })

function Upload() {
  return (
    <div className="rc rc-upload">
      <div className="rc-file" style={d(0.1)}>
        <span className="rc-file-tag">MOV</span>
        <span>
          <b>launch-film.mov</b>
          <small>4.2 GB · going up in 16 parts, 4 at a time</small>
        </span>
        <em>
          <Count to={4.2} ms={2600} delay={300} format={(n) => `${n.toFixed(1)} GB`} />
        </em>
      </div>
      <div className="rc-parts" aria-hidden="true">
        {Array.from({ length: 16 }, (_, i) => (
          <i key={i} className={i === 6 ? 'is-retry' : ''} style={d(0.35 + Math.floor(i / 4) * 0.55 + (i % 4) * 0.08 + (i === 6 ? 1.1 : 0))} />
        ))}
      </div>
      <p className="rc-note" style={d(2.4)}>
        <span className="rc-dot is-warn" /> Part 7 dropped and was retried on its own. Nothing else was sent twice.
      </p>
    </div>
  )
}

const LADDER = [
  { rung: '2160p', w: 100 },
  { rung: '1080p', w: 62 },
  { rung: '720p', w: 38 },
  { rung: '480p', w: 22 },
]
const CODECS = [
  { name: 'H.264', scale: 1, size: '1.9 GB' },
  { name: 'HEVC', scale: 0.65, size: '1.2 GB' },
  { name: 'AV1', scale: 0.55, size: '1.0 GB' },
]
function Encode() {
  return (
    <div className="rc rc-encode">
      <div className="rc-ladder">
        <span />
        {CODECS.map((c, j) => (
          <b key={c.name} style={d(0.1 + j * 0.15)}>
            {c.name}
            <small>{c.size}</small>
          </b>
        ))}
        {LADDER.map((r, i) => (
          <div key={r.rung} className="rc-row">
            <span style={d(0.2 + i * 0.12)}>{r.rung}</span>
            {CODECS.map((c, j) => (
              <i key={c.name} className={j === 0 ? '' : 'is-new'} style={{ ...d(0.45 + i * 0.18 + j * 0.32), ['--w' as string]: `${r.w * c.scale}%` }} />
            ))}
          </div>
        ))}
      </div>
      <p className="rc-note" style={d(2.5)}>
        <span className="rc-dot" /> Same picture, a third smaller in HEVC and almost half in AV1. Each viewer gets the smallest one their device plays.
      </p>
    </div>
  )
}

const CUES = [
  { at: '00:00:01.200', text: 'Welcome to the launch.' },
  { at: '00:00:03.800', text: 'Everything you see was uploaded once.' },
  { at: '00:00:06.500', text: 'And it plays everywhere.' },
]
function Captions() {
  return (
    <div className="rc rc-captions">
      <div className="rc-wave" aria-hidden="true">
        {Array.from({ length: 56 }, (_, i) => (
          <i key={i} style={{ ['--h' as string]: `${20 + Math.abs(Math.sin(i * 0.7) * 55 + Math.sin(i * 0.23) * 25)}%`, ['--i' as string]: i }} />
        ))}
        <b className="rc-scan" />
      </div>
      <ol className="rc-cues">
        {CUES.map((c, i) => (
          <li key={c.at} style={d(0.5 + i * 0.9)}>
            <code>{c.at}</code>
            <span>{c.text}</span>
          </li>
        ))}
      </ol>
      <p className="rc-note" style={d(3.1)}>
        <span className="rc-dot is-good" /> English, detected · captions.en.vtt · the CC button appears in the player
      </p>
    </div>
  )
}

// placed by longitude and latitude on a 160 × 60 strip of the world (130°W–60°E, 65°N–20°S)
const geo = (lon: number, lat: number) => ({ x: ((lon + 130) / 190) * 160, y: ((65 - lat) / 85) * 60 })
// the worked example's viewers, with the startup times the player reported for them
const CITIES = [
  { name: 'Lagos', ...geo(3.4, 6.5), ms: 640 },
  { name: 'Paris', ...geo(2.35, 48.9), ms: 410 },
  { name: 'New York', ...geo(-74, 40.7), ms: 520 },
]
function Deliver() {
  return (
    <div className="rc rc-deliver">
      <svg viewBox="0 0 160 60" className="rc-map" aria-hidden="true">
        {Array.from({ length: 27 * 8 }, (_, i) => (
          <circle key={i} cx={2 + (i % 27) * 6} cy={3 + Math.floor(i / 27) * 7.8} r="0.4" className="rc-grid" />
        ))}
        {CITIES.slice(1).map((c, i) => (
          <path key={c.name} d={`M ${CITIES[0].x} ${CITIES[0].y} Q ${(CITIES[0].x + c.x) / 2} ${Math.min(CITIES[0].y, c.y) - 16} ${c.x} ${c.y}`} className="rc-arc" style={d(0.4 + i * 0.5)} pathLength={1} />
        ))}
        {CITIES.map((c, i) => (
          <g key={c.name} className="rc-city" style={d(0.2 + i * 0.5)}>
            <circle cx={c.x} cy={c.y} r="1.6" />
            <circle cx={c.x} cy={c.y} r="1.6" className="rc-ping" />
            <text x={c.x + 3.2} y={c.y + 1.1}>
              {c.name} · {c.ms} ms
            </text>
          </g>
        ))}
      </svg>
      <div className="rc-devices">
        {['Web', 'iOS', 'Android', 'TV'].map((x, i) => (
          <span key={x} style={d(1.6 + i * 0.2)}>
            {x}
          </span>
        ))}
      </div>
      <p className="rc-note" style={d(2.6)}>
        <span className="rc-dot is-good" /> One playback URL for every screen, and the player reports how fast each viewer started.
      </p>
    </div>
  )
}

function Watch({ onReplay }: { onReplay: () => void }) {
  const spark = [4, 6, 5, 9, 12, 11, 16, 22, 21, 28, 34, 41]
  return (
    <div className="rc rc-watch">
      <div className="rc-stats">
        <div style={d(0.1)}>
          <small>Views</small>
          <b>
            <Count to={1284} ms={1800} delay={200} />
          </b>
        </div>
        <div style={d(0.25)}>
          <small>Watched to the end</small>
          <b>
            <Count to={92} ms={1800} delay={350} />%
          </b>
        </div>
        <div style={d(0.4)}>
          <small>Avg. time to first frame</small>
          <b>
            <Count to={520} ms={1400} delay={500} /> ms
          </b>
        </div>
      </div>
      <svg viewBox="0 0 110 30" className="rc-spark" aria-hidden="true" preserveAspectRatio="none" style={d(0.6)}>
        <polyline points={spark.map((v, i) => `${i * 10},${30 - v * 0.65}`).join(' ')} />
      </svg>
      <div className="rc-link" style={d(1.4)}>
        <span className="rc-lock" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z" />
          </svg>
        </span>
        <code>mediaex.io/embed/ast_k2v8m1?token=…</code>
        <small>expires in 24 h</small>
      </div>
      <div className="rc-end" style={d(2)}>
        <a href="/sign-up" className="btn btn-primary btn-sm">
          Start free
        </a>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReplay}>
          Replay
        </button>
      </div>
    </div>
  )
}

export default function HeroReel() {
  const control = useRef<ReelControl>({ playing: false, changedAt: 0, hover: false })
  const [playing, setPlaying] = useState(false)
  const [chapter, setChapter] = useState(-1)
  const [run, setRun] = useState(0)
  const [played, setPlayed] = useState(false)
  const frame = useRef<HTMLDivElement>(null)

  const start = useCallback(() => {
    control.current = { ...control.current, playing: true, changedAt: performance.now(), hover: false }
    setPlaying(true)
    setPlayed(true)
    setChapter(-1)
    setRun((r) => r + 1)
  }, [])
  const stop = useCallback(() => {
    control.current = { ...control.current, playing: false, changedAt: performance.now() }
    setPlaying(false)
    setChapter(-1)
  }, [])

  // after the prism's exit, the first chapter; then one chapter every CHAPTER_MS; after the last, the prism returns
  useEffect(() => {
    if (!playing) return
    const t = setTimeout(
      () => (chapter + 1 < CHAPTERS.length ? setChapter(chapter + 1) : stop()),
      chapter < 0 ? AWAY_MS : chapter === CHAPTERS.length - 1 ? CHAPTER_MS + 2500 : CHAPTER_MS,
    )
    return () => clearTimeout(t)
  }, [playing, chapter, run, stop])

  // it plays by itself once per visit: shortly after the intro, while the hero is on screen (never with reduced motion)
  useEffect(() => {
    const el = frame.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    try {
      if (sessionStorage.getItem('mx-tour-autoplayed')) return
    } catch {}
    let timer: ReturnType<typeof setTimeout> | undefined
    const io = new IntersectionObserver(
      ([e]) => {
        clearTimeout(timer)
        if (!e.isIntersecting) return
        timer = setTimeout(() => {
          io.disconnect()
          try {
            sessionStorage.setItem('mx-tour-autoplayed', '1')
          } catch {}
          if (!control.current.playing) start()
        }, 2600)
      },
      { threshold: 0.6 },
    )
    io.observe(el)
    return () => {
      clearTimeout(timer)
      io.disconnect()
    }
  }, [start])

  // Escape stops; "Watch the film" (data-play-tour) starts it from anywhere on the page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && playing && stop()
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-play-tour]')
      if (!el) return
      e.preventDefault()
      frame.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      start()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onClick)
    }
  }, [playing, start, stop])

  const now = chapter >= 0 ? CHAPTERS[chapter] : null

  return (
    <div ref={frame} className={`viewfinder ${playing ? 'is-playing' : ''}`} id="tour">
      <HeroScene mode="frame" control={control} />
      <span className="vf-corner tl" aria-hidden="true" />
      <span className="vf-corner tr" aria-hidden="true" />
      <span className="vf-corner bl" aria-hidden="true" />
      <span className="vf-corner br" aria-hidden="true" />
      <div className="vf-meta top" aria-hidden="true">
        <span className="vf-live">
          <i />
          {playing ? 'Playing' : 'Live'}
        </span>
        <Timecode />
      </div>

      {/* idle: the prism is the play button */}
      {!playing && (
        <button
          type="button"
          className="reel-play"
          aria-label={played ? 'Replay the 20-second tour of MediaEX' : 'Play a 20-second tour of MediaEX'}
          onClick={start}
          onPointerEnter={() => (control.current.hover = true)}
          onPointerLeave={() => (control.current.hover = false)}
          onFocus={() => (control.current.hover = true)}
          onBlur={() => (control.current.hover = false)}
        >
          <span className="reel-hint">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5 3.5v9l7-4.5-7-4.5Z" />
            </svg>
            {played ? 'Replay the tour' : 'Play the 20-second tour'}
          </span>
        </button>
      )}

      {/* playing: one chapter at a time */}
      {playing && (
        <div className="reel-stage" role="region" aria-label="MediaEX tour" aria-live="polite">
          {now && (
            <div key={`${now.key}-${run}`} className="reel-chapter">
              <p className="reel-kicker">
                <b>0{chapter + 1}</b> / 0{CHAPTERS.length} · {now.name}
              </p>
              {now.key === 'upload' && <Upload />}
              {now.key === 'encode' && <Encode />}
              {now.key === 'captions' && <Captions />}
              {now.key === 'deliver' && <Deliver />}
              {now.key === 'watch' && <Watch onReplay={start} />}
            </div>
          )}
        </div>
      )}

      <div className={`vf-meta bottom ${playing ? 'is-hidden' : ''}`} aria-hidden="true">
        <span>4K · 24 fps · AV1</span>
        <span className="hide-sm">HLS · Lagos → Paris → New York</span>
      </div>

      {playing && (
        <div className="reel-bar">
          <div className="reel-chapters" role="tablist" aria-label="Tour chapters">
            {CHAPTERS.map((c, i) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={i === chapter}
                className={i < chapter ? 'is-done' : i === chapter ? 'is-now' : ''}
                onClick={() => {
                  setChapter(i)
                  setRun((r) => r + 1)
                }}
              >
                <i>
                  <em key={`${i}-${chapter}-${run}`} style={{ ['--ms' as string]: `${i === CHAPTERS.length - 1 ? CHAPTER_MS + 2500 : CHAPTER_MS}ms` }} />
                </i>
                <span>{c.name}</span>
              </button>
            ))}
          </div>
          <span className="reel-meta hide-sm">{now?.meta ?? 'Starting…'}</span>
          <button type="button" className="reel-close" aria-label="Stop the tour" onClick={stop}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
