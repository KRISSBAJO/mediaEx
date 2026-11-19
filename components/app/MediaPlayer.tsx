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
  asset: Pick<MediaAsset, 'type' | 'status' | 'playbackUrl' | 'posterUrl' | 'thumbUrl' | 'duration' | 'width' | 'height' | 'renditions' | 'progress' | 'title'>
  corners?: boolean
}

function tc(s: number) {
  const t = Math.floor(s)
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((n) => String(n).padStart(2, '0')).join(':')
}

export default function MediaPlayer({ asset, corners = true }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const media = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [len, setLen] = useState(asset.duration || 0)
  const [err, setErr] = useState('')
  const [level, setLevel] = useState<string | null>(null)
  const url = asset.status === 'ready' ? asset.playbackUrl : null

  useEffect(() => {
    const el = media.current
    if (!el || !url) return
    let cancelled = false
    let destroy = () => {}
    setErr('')
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = url
    } else {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return
        if (!Hls.isSupported()) return setErr('This browser can’t play adaptive streams.')
        const hls = new Hls({ capLevelToPlayerSize: true })
        hls.loadSource(url)
        hls.attachMedia(el)
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => {
          const l = hls.levels[d.level]
          setLevel(l?.height ? `${Math.min(l.width, l.height)}p` : null)
        })
        hls.on(Hls.Events.ERROR, (_e, d) => {
          if (d.fatal) setErr(d.type === 'networkError' ? 'The stream couldn’t be loaded.' : 'The stream couldn’t be decoded.')
        })
        destroy = () => hls.destroy()
      })
    }
    return () => {
      cancelled = true
      destroy()
      el.removeAttribute('src')
      el.load()
    }
  }, [url])

  const toggle = () => {
    const el = media.current
    if (!el || !url) return
    if (el.paused) void el.play().catch(() => setErr('Press play again — the browser blocked playback.'))
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
      ? `${level ?? top[0]?.name ?? (asset.height ? `${Math.min(asset.width ?? 0, asset.height)}p` : '')} · H.264 · HLS`
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
            />
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
