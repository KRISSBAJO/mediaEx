'use client'

/**
 * Plays an asset's HLS stream (native HLS where the browser has it, hls.js elsewhere), shows an image's poster,
 * or explains where the asset is in the pipeline. Used in the dashboard and on the public /embed page.
 */
import { useEffect, useRef, useState } from 'react'
import { duration as fmtDuration } from '@/lib/sample'
import type { MediaAsset } from '@/lib/media/types'
import Icon from './Icon'

type Props = {
  asset: Pick<MediaAsset, 'id' | 'type' | 'status' | 'playbackUrl' | 'playbackUrls' | 'captions' | 'posterUrl' | 'thumbUrl' | 'duration' | 'width' | 'height' | 'renditions' | 'progress' | 'title'>
  corners?: boolean
  /** report viewing to analytics (the public share/embed player; dashboard previews aren't audience) */
  track?: boolean
}

type Source = { url: string; codec: 'H.264' | 'HEVC' | 'AV1' }
/** The smallest ladder this device decodes: AV1, then HEVC, then H.264 (which plays everywhere). */
function pickSource(asset: Props['asset']): Source | null {
  if (asset.status !== 'ready' || !asset.playbackUrl) return null
  const urls = asset.playbackUrls ?? {}
  const mse = typeof MediaSource !== 'undefined' ? (t: string) => MediaSource.isTypeSupported(t) : (t: string) => document.createElement('video').canPlayType(t) !== ''
  if (urls.av1 && mse('video/mp4; codecs="av01.0.08M.08"')) return { url: urls.av1, codec: 'AV1' }
  if (urls.hevc && mse('video/mp4; codecs="hvc1.1.6.L120.90"')) return { url: urls.hevc, codec: 'HEVC' }
  return { url: asset.playbackUrl, codec: 'H.264' }
}

const rid = () => {
  const abc = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => abc[b % 62]).join('')
}
/** one id per browser, so unique viewers can be counted; nothing personal in it */
function viewerId() {
  try {
    const v = localStorage.getItem('mx-viewer')
    if (v && /^[A-Za-z0-9]{24}$/.test(v)) return v
    const n = rid()
    localStorage.setItem('mx-viewer', n)
    return n
  } catch {
    return rid()
  }
}

function tc(s: number) {
  const t = Math.floor(s)
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((n) => String(n).padStart(2, '0')).join(':')
}

export default function MediaPlayer({ asset, corners = true, track = false }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const media = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [len, setLen] = useState(asset.duration || 0)
  const [err, setErr] = useState('')
  const [level, setLevel] = useState<string | null>(null)
  // chosen in the browser (it depends on what this device decodes); a codec that fails to decode drops back to H.264
  const [source, setSource] = useState<Source | null>(null)
  useEffect(() => setSource(pickSource(asset)), [asset.status, asset.playbackUrl, asset.playbackUrls?.av1, asset.playbackUrls?.hevc]) // eslint-disable-line react-hooks/exhaustive-deps
  const url = source?.url ?? null
  // bytes the stream loaded, for analytics; hls.js reports each segment
  const loadedBytes = useRef(0)
  const fatal = useRef(false)

  useEffect(() => {
    const el = media.current
    if (!el || !url) return
    let cancelled = false
    let destroy = () => {}
    setErr('')
    // hls.js wherever Media Source Extensions exist (Chrome, Edge, Firefox, Android); the browser's own HLS only where
    // they don't (iOS Safari). Chrome's built-in HLS rejects segments served from another origin, such as a bucket.
    import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return
      if (!Hls.isSupported()) {
        if (el.canPlayType('application/vnd.apple.mpegurl')) el.src = url
        else setErr('This browser can’t play adaptive streams.')
        return
      }
      const hls = new Hls({ capLevelToPlayerSize: true })
      hls.loadSource(url)
      hls.attachMedia(el)
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => {
        const l = hls.levels[d.level]
        setLevel(l?.height ? `${Math.min(l.width, l.height)}p` : null)
      })
      hls.on(Hls.Events.FRAG_LOADED, (_e, d) => {
        loadedBytes.current += d.frag.stats.loaded || 0
      })
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return
        if (d.type === 'mediaError' && source && source.codec !== 'H.264' && asset.playbackUrl) {
          setSource({ url: asset.playbackUrl, codec: 'H.264' })
          return
        }
        fatal.current = true
        setErr(d.type === 'networkError' ? 'The stream couldn’t be loaded.' : 'The stream couldn’t be decoded.')
      })
      destroy = () => hls.destroy()
    })
    return () => {
      cancelled = true
      destroy()
      el.removeAttribute('src')
      el.load()
    }
  }, [url])

  // analytics heartbeat: time watched, how far, startup time, stalls and bytes, sent every 15 s and when playback stops
  useEffect(() => {
    const el = media.current
    if (!track || !el || !url) return
    const token = new URL(url, location.href).searchParams.get('token')
    const beacon = `/api/media/${asset.id}/views${token ? `?token=${encodeURIComponent(token)}` : ''}`
    const s = { id: rid(), viewer: viewerId(), watch: 0, rebuffer: 0, max: 0, last: 0, playAt: 0, stallAt: 0, startup: 0, started: false, sentStartup: false, sentError: false }
    let referrer: string | null = null
    try {
      referrer = document.referrer ? new URL(document.referrer).host : null
    } catch {}
    const send = () => {
      const bytes = loadedBytes.current
      const error = fatal.current && !s.sentError
      if (s.watch < 0.5 && !bytes && !error && (s.sentStartup || !s.startup)) return
      const body = JSON.stringify({
        id: s.id, viewer: s.viewer, watch: s.watch, position: s.max, rebufferMs: s.rebuffer, bytes, error,
        ...(s.startup && !s.sentStartup ? { startupMs: s.startup } : {}),
        referrer, hour: new Date().getHours(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      s.watch = 0
      s.rebuffer = 0
      loadedBytes.current = 0
      if (s.startup) s.sentStartup = true
      if (error) s.sentError = true
      if (!navigator.sendBeacon?.(beacon, body)) void fetch(beacon, { method: 'POST', body, keepalive: true }).catch(() => {})
    }
    const now = () => performance.now()
    const on: Record<string, () => void> = {
      play: () => void (!s.started && !s.playAt && (s.playAt = now())),
      playing: () => {
        if (!s.started) {
          s.started = true
          if (s.playAt) s.startup = Math.round(now() - s.playAt)
        }
        if (s.stallAt) s.rebuffer += now() - s.stallAt
        s.stallAt = 0
      },
      waiting: () => void (s.started && !el.seeking && (s.stallAt = now())),
      timeupdate: () => {
        const c = el.currentTime
        const d = c - s.last
        if (!el.paused && d > 0 && d < 2) s.watch += d
        s.last = c
        if (d > 0 && d < 2) s.max = Math.max(s.max, c)
      },
      seeked: () => void (s.last = el.currentTime),
      pause: send,
      ended: send,
    }
    for (const [k, f] of Object.entries(on)) el.addEventListener(k, f)
    const hidden = () => document.visibilityState === 'hidden' && send()
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', send)
    const timer = setInterval(() => !el.paused && send(), 15_000)
    return () => {
      send()
      for (const [k, f] of Object.entries(on)) el.removeEventListener(k, f)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', send)
      clearInterval(timer)
    }
  }, [track, url, asset.id])

  // captions: one <track> per ready language; CC cycles off → each language → off
  const tracks = (asset.captions ?? []).filter((c) => c.url)
  const [cc, setCc] = useState<string | null>(null)
  useEffect(() => {
    const el = media.current
    if (!el) return
    for (const t of Array.from(el.textTracks)) t.mode = t.language === cc ? 'showing' : 'disabled'
  }, [cc, tracks.length])
  const nextCaptions = () => {
    if (!tracks.length) return
    if (cc === null) {
      // start with the viewer's language when there's a track in it
      const mine = navigator.language.slice(0, 2)
      setCc((tracks.find((t) => t.lang === mine) ?? tracks[0]).lang)
      return
    }
    const i = tracks.findIndex((t) => t.lang === cc)
    setCc(i < tracks.length - 1 ? tracks[i + 1].lang : null)
  }

  const toggle = () => {
    const el = media.current
    if (!el || !url) return
    if (el.paused)
      void el.play().catch((e: DOMException) => {
        if (e.name === 'NotAllowedError') setErr('Press play again — the browser blocked playback.')
        else if (e.name !== 'AbortError') setErr('The stream couldn’t be played.')
      })
    else el.pause()
  }
  const seekTo = (s: number) => {
    const el = media.current
    if (!el || !len) return
    el.currentTime = Math.max(0, Math.min(len, s))
    setT(el.currentTime)
  }
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    seekTo(((e.clientX - r.left) / r.width) * len)
  }
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void wrap.current?.requestFullscreen?.()
  }

  const top = asset.renditions.filter((r) => r.name.endsWith('p'))
  const label =
    asset.type === 'video'
      ? `${level ?? top[0]?.name ?? (asset.height ? `${Math.min(asset.width ?? 0, asset.height)}p` : '')} · ${source?.codec ?? 'H.264'} · HLS`
      : asset.type === 'audio'
        ? 'AAC · 160 kbps · HLS'
        : asset.width
          ? `${asset.width}×${asset.height}`
          : 'Image'

  const still = asset.type === 'image' ? asset.posterUrl : asset.type === 'audio' ? asset.thumbUrl : asset.thumbUrl

  return (
    <div
      ref={wrap}
      className={`player player-${asset.type} ${playing ? 'is-playing' : ''}`}
      onKeyDown={(e) => {
        if (!url) return
        if (e.key === ' ' || e.key === 'k') (e.preventDefault(), toggle())
        if (e.key === 'ArrowRight') seekTo(t + 5)
        if (e.key === 'ArrowLeft') seekTo(t - 5)
        if (e.key === 'f' && asset.type === 'video') fullscreen()
        if (e.key === 'c') nextCaptions()
      }}
    >
      <div className="player-frame">
        {asset.type === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element -- poster from our own media route
          still ? <img src={still} alt={asset.title} className="player-still" /> : null
        ) : (
          <>
            {/* audio plays through a <video> element too; it shows the waveform as its poster */}
            <video
              ref={media}
              className={asset.type === 'audio' ? 'player-media is-audio' : 'player-media'}
              poster={still ?? undefined}
              playsInline
              preload="metadata"
              onClick={toggle}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLen(e.currentTarget.duration)}
            >
              {tracks.map((c) => (
                <track key={c.lang} kind="subtitles" srcLang={c.lang} label={c.label} src={c.url!} />
              ))}
            </video>
          </>
        )}
        {!url && asset.type !== 'image' && (
          <div className="player-state">
            {asset.status === 'failed' ? (
              <>
                <Icon name="alert" size={20} />
                <b>This asset couldn’t be processed</b>
              </>
            ) : (
              <>
                <span className="player-spinner" aria-hidden="true" />
                <b>{asset.status === 'uploading' ? 'Uploading…' : asset.status === 'queued' ? 'Waiting for an encoder…' : `Encoding · ${Math.round(asset.progress)}%`}</b>
                <small>It plays here as soon as it’s ready.</small>
              </>
            )}
          </div>
        )}
        {asset.type === 'image' && !still && (
          <div className="player-state">
            <span className="player-spinner" aria-hidden="true" />
            <b>Preparing the image…</b>
          </div>
        )}
      </div>

      {corners && (
        <>
          <span className="vf-corner tl" aria-hidden="true" />
          <span className="vf-corner tr" aria-hidden="true" />
          <span className="vf-corner bl" aria-hidden="true" />
          <span className="vf-corner br" aria-hidden="true" />
        </>
      )}
      <div className="player-meta" aria-hidden="true">
        <span>{label}</span>
        {asset.type !== 'image' && <span>{tc(t)}</span>}
      </div>

      {err && (
        <div className="player-error" role="alert">
          <Icon name="alert" size={15} /> {err}
        </div>
      )}

      {url && (
        <>
          <button type="button" className="player-play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>
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
              aria-valuetext={`${fmtDuration(Math.round(t))} of ${fmtDuration(Math.round(len))}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                seek(e)
              }}
              onPointerMove={(e) => e.buttons === 1 && seek(e)}
            >
              <i style={{ width: `${len ? (t / len) * 100 : 0}%` }} />
              <b style={{ left: `${len ? (t / len) * 100 : 0}%` }} />
            </div>
            <span>
              {fmtDuration(Math.round(t)) === '—' ? '0:00' : fmtDuration(Math.round(t))} / {fmtDuration(Math.round(len))}
            </span>
            {tracks.length > 0 && (
              <button
                type="button"
                className={`player-fs player-cc ${cc ? 'is-on' : ''}`}
                aria-label={cc ? `Captions: ${tracks.find((t) => t.lang === cc)?.label}. Press for the next language or off.` : 'Turn on captions'}
                aria-pressed={cc !== null}
                title={cc ? tracks.find((t) => t.lang === cc)?.label : 'Captions'}
                onClick={nextCaptions}
              >
                CC
              </button>
            )}
            {asset.type === 'video' && (
              <button type="button" className="player-fs" aria-label="Full screen" onClick={fullscreen}>
                <Icon name="external" size={15} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
