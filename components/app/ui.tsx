'use client'

import { useEffect, useState } from 'react'
import type { MediaAsset, MediaStatus, MediaType } from '@/lib/media/types'
import type { Point, Range } from '@/lib/sample'
import { duration as fmtDuration } from '@/lib/sample'
import Icon from './Icon'

/* ------------------------------------------------ thumbnails: the real frame (or waveform) once the pipeline made one */
export function Thumb({ asset, className = '' }: { asset: Pick<MediaAsset, 'type' | 'thumbUrl' | 'duration'>; className?: string }) {
  return (
    <div className={`thumb thumb-${asset.type} ${asset.thumbUrl ? 'has-img' : 'is-empty'} ${className}`}>
      {asset.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by our own media route, already sized
        <img src={asset.thumbUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <Icon name={asset.type} size={18} />
      )}
      {asset.duration > 0 && <span className="thumb-dur">{fmtDuration(Math.round(asset.duration))}</span>}
    </div>
  )
}

/* ------------------------------------------------ status: colour + icon + label, never colour alone */
const STATUS: Record<MediaStatus, { label: string; icon: string }> = {
  uploading: { label: 'Uploading', icon: 'upload' },
  queued: { label: 'Queued', icon: 'clock' },
  processing: { label: 'Processing', icon: 'refresh' },
  ready: { label: 'Ready', icon: 'check' },
  failed: { label: 'Failed', icon: 'alert' },
}

export function StatusBadge({ status, progress }: { status: MediaStatus; progress?: number }) {
  const s = STATUS[status]
  return (
    <span className={`status status-${status}`}>
      <Icon name={s.icon} size={13} />
      {s.label}
      {status === 'processing' && progress ? <em>{Math.round(progress)}%</em> : null}
    </span>
  )
}

/** Shown instead of the date on assets that aren't public yet. */
export function ModerationBadge({ state }: { state: MediaAsset['moderation'] }) {
  if (state === 'approved') return null
  return (
    <span className={`status ${state === 'pending' ? 'status-review' : 'status-failed'}`}>
      <Icon name={state === 'pending' ? 'clock' : 'x'} size={13} />
      {state === 'pending' ? 'In review' : 'Rejected'}
    </span>
  )
}

export function TypeIcon({ type }: { type: MediaType }) {
  return <Icon name={type} size={15} className="type-icon" />
}

/* ------------------------------------------------ layout bits */
export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  )
}

export function Card({
  title,
  meta,
  action,
  children,
  className = '',
  flush,
  hint,
  footer,
}: {
  title?: React.ReactNode
  meta?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  flush?: boolean
  /** left side of the footer bar */
  hint?: React.ReactNode
  /** right side of the footer bar (buttons) */
  footer?: React.ReactNode
}) {
  return (
    <section className={`panel ${flush ? 'is-flush' : ''} ${className}`}>
      {(title || action) && (
        <header className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {meta && <span>{meta}</span>}
          </div>
          {action}
        </header>
      )}
      {children}
      {(hint || footer) && (
        <footer className="panel-foot">
          {hint && <span>{hint}</span>}
          {footer && <div>{footer}</div>}
        </footer>
      )}
    </section>
  )
}

export function Avatar({ initials, size = 28 }: { initials: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials}
    </span>
  )
}

export function Meter({ value, max, tone }: { value: number; max: number; tone?: 'warn' | 'bad' }) {
  const p = Math.min(1, value / max)
  const t = tone ?? (p > 0.9 ? 'bad' : p > 0.75 ? 'warn' : undefined)
  return (
    <span className={`meter ${t ? `is-${t}` : ''}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <i style={{ width: `${p * 100}%` }} />
    </span>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} className={o.value === value ? 'is-on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const RANGES: { value: Range; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
]

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={t.value === value} className={t.value === value ? 'is-on' : ''} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && <em>{t.count}</em>}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------ stat tile with sparkline */
export function Sparkline({ points }: { points: Point[] }) {
  if (points.length < 2) return null // nothing to draw yet (the data is still loading)
  const w = 120
  const h = 32
  const vals = points.map((p) => p.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const xy = vals.map((v, i) => [(i / (vals.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / (max - min || 1)) * (h - 6)])
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  const [lx, ly] = xy[xy.length - 1]
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} />
      <circle cx={lx} cy={ly} r="2.5" />
    </svg>
  )
}

export function StatTile({
  label,
  value,
  unit,
  delta,
  upIsGood = true,
  points,
  period,
}: {
  label: string
  value: string
  unit?: string
  delta?: number
  upIsGood?: boolean
  points?: Point[]
  period?: string
}) {
  const good = delta === undefined ? undefined : delta >= 0 === upIsGood
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <div className="stat-row">
        <strong>
          {value}
          {unit && <em>{unit}</em>}
        </strong>
        {points && <Sparkline points={points.slice(-12)} />}
      </div>
      {delta !== undefined && (
        <span className={`delta ${good ? 'is-good' : 'is-bad'}`}>
          {delta >= 0 ? '↑' : '↓'} {Math.abs(delta * 100).toFixed(1)}%<span> vs previous {period}</span>
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------ toasts */
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent('mx-toast', { detail: message }))
}

export function Toaster() {
  const [items, setItems] = useState<{ id: number; message: string }[]>([])
  useEffect(() => {
    let n = 0
    const on = (e: Event) => {
      const id = ++n
      setItems((xs) => [...xs.slice(-2), { id, message: (e as CustomEvent<string>).detail }])
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2600)
    }
    window.addEventListener('mx-toast', on)
    return () => window.removeEventListener('mx-toast', on)
  }, [])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <Icon name="check" size={15} />
          {t.message}
        </div>
      ))}
    </div>
  )
}

export async function copyText(text: string, what = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text)
    toast(what)
  } catch {
    toast('Copy failed — select the text and copy it manually')
  }
}

/** A panel that couldn't load: says what failed, with the server's reason and a way to try again. */
export function LoadFailed({ what, detail, onRetry }: { what: string; detail?: string; onRetry?: () => void }) {
  return (
    <div className="banner is-bad" role="alert">
      <Icon name="alert" />
      <div>
        <b>Couldn’t load {what}.</b> {detail}
        <small>If this keeps happening, the API may not be reachable from the dashboard. Reloading the page usually fixes a one-off.</small>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry ?? (() => window.location.reload())}>
        Try again
      </button>
    </div>
  )
}
