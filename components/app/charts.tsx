'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { Point } from '@/lib/sample'

/* Single-series charts. One hue (the ink colour), 2px lines, a 10% area wash, hairline grid, a crosshair tooltip on
   lines and a per-mark tooltip on bars. Every chart can flip to a table so no value is only reachable by hovering. */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    setW(Math.round(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v)
  return ticks
}

export const fmtAxis = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${+(v / 1e3).toFixed(0)}K` : v.toLocaleString('en-US'))

function DataTable({ points, format, caption, xHead = 'Date', yHead = 'Value' }: { points: Point[]; format: (v: number) => string; caption: string; xHead?: string; yHead?: string }) {
  return (
    <div className="chart-table">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{xHead}</th>
            <th scope="col">{yHead}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ViewToggle({ table, onChange }: { table: boolean; onChange: (t: boolean) => void }) {
  return (
    <div className="seg seg-sm" role="group" aria-label="Show as">
      <button type="button" aria-pressed={!table} className={!table ? 'is-on' : ''} onClick={() => onChange(false)}>
        Chart
      </button>
      <button type="button" aria-pressed={table} className={table ? 'is-on' : ''} onClick={() => onChange(true)}>
        Table
      </button>
    </div>
  )
}

/* ------------------------------------------------ line / area with crosshair */
export function LineChart({
  points,
  height = 240,
  format = (v) => v.toLocaleString('en-US'),
  axisFormat = fmtAxis,
  area = true,
  yMax,
  label,
  table = false,
  xHead,
  yHead,
}: {
  points: Point[]
  height?: number
  format?: (v: number) => string
  axisFormat?: (v: number) => string
  area?: boolean
  yMax?: number
  label: string
  table?: boolean
  xHead?: string
  yHead?: string
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const gid = useId().replace(/:/g, '')

  if (table) return <DataTable points={points} format={format} caption={label} xHead={xHead} yHead={yHead} />

  const pad = { t: 12, r: 12, b: 26, l: 44 }
  const iw = Math.max(0, w - pad.l - pad.r)
  const ih = height - pad.t - pad.b
  const ticks = niceTicks(yMax ?? Math.max(...points.map((p) => p.value)))
  const top = ticks[ticks.length - 1]
  const x = (i: number) => pad.l + (points.length > 1 ? (i / (points.length - 1)) * iw : iw / 2)
  const y = (v: number) => pad.t + ih - (v / top) * ih
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
  const fill = `${line}L${x(points.length - 1).toFixed(1)},${pad.t + ih}L${pad.l},${pad.t + ih}Z`
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 84))))

  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect()
    const rel = (clientX - r.left - pad.l) / (iw || 1)
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))))
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1))
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? points.length) - 1))
    else if (e.key === 'Escape') setHover(null)
    else return
    e.preventDefault()
  }

  const hp = hover !== null ? points[hover] : null
  const tipLeft = hover !== null ? Math.min(Math.max(x(hover), 70), w - 70) : 0

  return (
    <div ref={ref} className="chart" style={{ height }}>
      {w > 0 && (
        <svg
          width={w}
          height={height}
          role="img"
          aria-label={`${label}. Use the arrow keys to read values.`}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#f2f1ee" stopOpacity="0.12" />
              <stop offset="1" stopColor="#f2f1ee" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} />
              <text className="tick" x={pad.l - 10} y={y(t)} dy="0.32em" textAnchor="end">
                {axisFormat(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % labelEvery === 0 || i === points.length - 1 ? (
              <text key={p.label} className="tick" x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
                {i % labelEvery === 0 && points.length - 1 - i < labelEvery / 2 && i !== points.length - 1 ? '' : p.label}
              </text>
            ) : null,
          )}
          {area && <path d={fill} fill={`url(#g${gid})`} />}
          <path className="line" d={line} />
          {hover !== null && (
            <g>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} />
              <circle className="dot" cx={x(hover)} cy={y(points[hover].value)} r="4.5" />
            </g>
          )}
        </svg>
      )}
      {hp && (
        <div className="tip" style={{ left: tipLeft, top: 0 }}>
          <strong>{format(hp.value)}</strong>
          <span>{hp.label}</span>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------ columns with per-bar hover */
export function ColumnChart({
  points,
  height = 220,
  format = (v) => v.toLocaleString('en-US'),
  label,
  highlight,
  table = false,
  xHead,
  yHead,
}: {
  points: Point[]
  height?: number
  format?: (v: number) => string
  label: string
  highlight?: number
  table?: boolean
  xHead?: string
  yHead?: string
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  if (table) return <DataTable points={points} format={format} caption={label} xHead={xHead} yHead={yHead} />

  const pad = { t: 12, r: 4, b: 26, l: 44 }
  const iw = Math.max(0, w - pad.l - pad.r)
  const ih = height - pad.t - pad.b
  const ticks = niceTicks(Math.max(...points.map((p) => p.value)))
  const top = ticks[ticks.length - 1]
  const band = iw / points.length
  const bw = Math.max(2, Math.min(24, band - 2))
  const y = (v: number) => pad.t + ih - (v / top) * ih
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 56))))

  const bar = (i: number, v: number) => {
    const x0 = pad.l + i * band + (band - bw) / 2
    const y0 = y(v)
    const h = pad.t + ih - y0
    const r = Math.min(4, bw / 2, h)
    return `M${x0},${pad.t + ih}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${pad.t + ih}Z`
  }

  const hp = hover !== null ? points[hover] : null
  const tipLeft = hover !== null ? Math.min(Math.max(pad.l + hover * band + band / 2, 70), w - 70) : 0

  return (
    <div ref={ref} className="chart" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} />
              <text className="tick" x={pad.l - 10} y={y(t)} dy="0.32em" textAnchor="end">
                {fmtAxis(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => (
            <g key={p.label}>
              <path className={`col ${i === hover ? 'is-hover' : ''} ${i === highlight ? 'is-hi' : ''}`} d={bar(i, p.value)} />
              <rect
                className="hit"
                x={pad.l + i * band}
                y={pad.t}
                width={band}
                height={ih}
                tabIndex={0}
                aria-label={`${p.label}: ${format(p.value)}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {i % labelEvery === 0 && (
                <text className="tick" x={pad.l + i * band + band / 2} y={height - 6} textAnchor="middle">
                  {p.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      {hp && (
        <div className="tip" style={{ left: tipLeft, top: 0 }}>
          <strong>{format(hp.value)}</strong>
          <span>{hp.label}</span>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------ ranked bars (values printed, so no hover needed) */
export function BarList({ points, format = (v) => v.toLocaleString('en-US'), max }: { points: Point[]; format?: (v: number) => string; max?: number }) {
  const top = max ?? Math.max(...points.map((p) => p.value))
  return (
    <ul className="barlist">
      {points.map((p) => (
        <li key={p.label}>
          <div className="barlist-row">
            <span>{p.label}</span>
            <b>{format(p.value)}</b>
          </div>
          <span className="barlist-track">
            <i style={{ width: `${(p.value / top) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  )
}
