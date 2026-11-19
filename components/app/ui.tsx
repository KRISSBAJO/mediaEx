'use client'

import { useEffect, useState } from 'react'
import type { Asset, AssetStatus, Point, Range } from '@/lib/sample'
import { duration as fmtDuration } from '@/lib/sample'
import Icon from './Icon'

/* ------------------------------------------------ thumbnails (generated, monochrome "film stills") */
const VIDEO_LOOKS = [
  // dusk horizon
  'radial-gradient(circle at 50% 58%, #e8e6e1 0 7%, rgba(232,230,225,.35) 8%, transparent 26%), linear-gradient(180deg, #4b4a46 0%, #2a2926 55%, #121211 56%, #0c0c0b 100%)',
  // stage light cone
  'conic-gradient(from 160deg at 50% -10%, transparent 0 12deg, rgba(242,241,238,.28) 18deg 26deg, transparent 32deg), radial-gradient(ellipse at 50% 100%, #3b3a37, #121211 70%)',
  // window light streak
  'linear-gradient(115deg, transparent 38%, rgba(242,241,238,.22) 40% 47%, transparent 49% 55%, rgba(242,241,238,.12) 57% 60%, transparent 62%), linear-gradient(180deg, #2e2d2a, #141413)',
  // portrait
  'radial-gradient(circle at 50% 44%, #8c8b87 0 13%, transparent 13.5%), radial-gradient(ellipse at 50% 112%, #6f6e6a 0 34%, transparent 34.5%), radial-gradient(circle at 30% 20%, #3a3936, #161615 70%)',
  // city grid at night
  'repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 2px, transparent 2px 14px), linear-gradient(0deg, #0e0e0d 0 30%, transparent 30%), linear-gradient(180deg, #3a3936, #1a1a19)',
]

export function Thumb({ asset, className = '' }: { asset: Pick<Asset, 'type' | 'thumb' | 'duration' | 'status'>; className?: string }) {
  const { type, thumb } = asset
  return (
    <div className={`thumb thumb-${type} ${className}`} style={type === 'video' ? { background: VIDEO_LOOKS[thumb % VIDEO_LOOKS.length] } : undefined}>
      {type === 'audio' && (
        <svg viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true">
          {Array.from({ length: 40 }, (_, i) => {
            // rounded so server and browser maths produce identical markup
            const h = Math.round((6 + Math.abs(Math.sin(i * 0.7 + thumb) * Math.cos(i * 0.23 + thumb * 2)) * 30) * 10) / 10
            return <rect key={i} x={i * 3 + 0.5} y={Math.round((20 - h / 2) * 100) / 100} width="1.6" height={h} rx="0.8" />
          })}
        </svg>
      )}
      {type === 'image' && (
        <div className="thumb-mosaic" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      )}
      {asset.duration > 0 && <span className="thumb-dur">{fmtDuration(asset.duration)}</span>}
    </div>
  )
}

/* ------------------------------------------------ status: colour + icon + label, never colour alone */
const STATUS: Record<AssetStatus, { label: string; icon: string }> = {
  ready: { label: 'Ready', icon: 'check' },
  processing: { label: 'Processing', icon: 'refresh' },
  queued: { label: 'Queued', icon: 'clock' },
  failed: { label: 'Failed', icon: 'alert' },
}

export function StatusBadge({ status, progress }: { status: AssetStatus; progress?: number }) {
  const s = STATUS[status]
  return (
    <span className={`status status-${status}`}>
      <Icon name={s.icon} size={13} />
      {s.label}
      {status === 'processing' && progress ? <em>{progress}%</em> : null}
    </span>
  )
}

export function TypeIcon({ type }: { type: Asset['type'] }) {
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
