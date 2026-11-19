'use client'

import { useEffect, useRef, useState } from 'react'
import { PLANS, formatSize, planFor } from '@/lib/plans'

/**
 * Pricing as one control: drag across your library size and the plan, the price and what you get follow.
 * The bars are the library filling up. Storage runs on a log scale from 10 GB to 20 TB, so each plan gets room.
 * On first view it sweeps once from a small library to a mid-size one, to show it can be dragged.
 */
const MIN = 10
const MAX = 20000
const toGb = (t: number) => MIN * Math.pow(MAX / MIN, t)
const toT = (gb: number) => Math.log(gb / MIN) / Math.log(MAX / MIN)
const clamp = (n: number) => Math.min(1, Math.max(0, n))

const BARS = 64
const HEIGHTS = Array.from({ length: BARS }, (_, i) => {
  const wave = Math.abs(Math.sin(i * 0.55) * 0.6 + Math.sin(i * 0.21 + 1) * 0.4)
  return Math.round((0.18 + 0.82 * (0.35 + 0.65 * wave) * (0.4 + 0.6 * (i / BARS))) * 100)
})
const TICKS = [10, 100, 1000, 10000, 20000]
// where each plan starts and ends on the scale
const ZONES = PLANS.map((p, i) => ({ plan: p, from: i === 0 ? 0 : toT(PLANS[i - 1].storageGb), to: i === PLANS.length - 1 ? 1 : toT(p.storageGb) }))

/** about 6 Mbps, a typical 1080p stream */
const GB_PER_HOUR = 2.7
const hours = (gb: number) => {
  const h = gb / GB_PER_HOUR
  if (h < 100) return Math.max(1, Math.round(h)).toString()
  if (h < 1000) return (Math.round(h / 10) * 10).toString()
  return (Math.round(h / 100) * 100).toLocaleString('en-US')
}

/** eases the shown price towards the real one, so a plan change counts up or down */
function useTween(target: number) {
  const [v, setV] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min((now - start) / 520, 1)
      const n = a + (target - a) * (1 - Math.pow(1 - p, 3))
      from.current = n
      setV(n)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return Math.round(v)
}

export default function PriceDial() {
  const [t, setT] = useState(toT(40))
  const [yearly, setYearly] = useState(true)
  const [dragging, setDragging] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const touched = useRef(false)

  const gb = toGb(t)
  const plan = planFor(gb)
  const over = gb > plan.storageGb
  const price = useTween(yearly ? plan.yearly : plan.monthly)

  // the one-time sweep when the dial first comes into view
  useEffect(() => {
    const el = stage.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        const a = toT(40)
        const b = toT(700)
        const start = performance.now() + 350
        const tick = (now: number) => {
          if (touched.current) return
          const p = clamp((now - start) / 2000)
          const k = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
          setT(a + (b - a) * k)
          if (p < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      },
      { threshold: 0.6 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  const fromPointer = (x: number) => {
    const r = stage.current!.getBoundingClientRect()
    setT(clamp((x - r.left) / r.width))
  }

  const label = `${formatSize(gb)}: ${plan.name}, ${plan.monthly === 0 ? 'free' : `$${yearly ? plan.yearly : plan.monthly} a month`}${over ? ' plus storage over 10 TB' : ''}`

  return (
    <div className="pd" style={{ ['--t' as string]: t }}>
      <div className="pd-top">
        <div className="pd-read">
          <span className="overline">Your library</span>
          <strong className="pd-size">{formatSize(gb)}</strong>
          <span className="pd-hours">≈ {hours(gb)} hours of 1080p video</span>
        </div>
        <div className="pd-quote">
          <div className="pd-quote-head">
            <span key={plan.name} className="pd-plan">
              {plan.name}
              {plan.featured && <em>Most popular</em>}
            </span>
            <div className="pd-bill" role="group" aria-label="Billing period">
              <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>
                Monthly
              </button>
              <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>
                Yearly
              </button>
            </div>
          </div>
          <div className="pd-amt">
            <span className="pd-cur">$</span>
            <span className="pd-num">{price}</span>
            {over && <span className="pd-plus">+ usage</span>}
          </div>
          <span className="pd-per">
            {plan.monthly === 0 ? 'Free forever, no card needed' : over ? 'a month, plus storage over 10 TB' : yearly ? 'a month, billed yearly' : 'a month, billed monthly'}
          </span>
        </div>
      </div>

      <div
        ref={stage}
        className={`pd-stage ${dragging ? 'is-dragging' : ''}`}
        onPointerDown={(e) => {
          touched.current = true
          stage.current!.setPointerCapture(e.pointerId)
          setDragging(true)
          // on touch, wait for a sideways move so a vertical scroll that starts here doesn't jump the dial
          if (e.pointerType !== 'touch') fromPointer(e.clientX)
        }}
        onPointerMove={(e) => dragging && fromPointer(e.clientX)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="pd-zones" aria-hidden="true">
          {ZONES.map((z) => (
            <span
              key={z.plan.name}
              className={z.plan === plan ? 'is-on' : ''}
              style={{ left: `${z.from * 100}%`, width: `${(z.to - z.from) * 100}%` }}
            >
              <b>{z.plan.name}</b>
              <i>{z.plan.monthly === 0 ? 'Free' : `$${yearly ? z.plan.yearly : z.plan.monthly}`}</i>
            </span>
          ))}
        </div>
        <div className="pd-bars" aria-hidden="true">
          {HEIGHTS.map((h, i) => {
            const x = (i + 0.5) / BARS
            const zone = ZONES.findIndex((z) => x <= z.to)
            return <i key={i} className={x <= t ? `is-on z${zone}` : ''} style={{ height: `${h}%` }} />
          })}
        </div>
        <div className="pd-axis" aria-hidden="true">
          {TICKS.map((g) => (
            <span key={g} style={{ left: `${toT(g) * 100}%` }}>
              {formatSize(g)}
            </span>
          ))}
        </div>
        <span className="pd-thumb" aria-hidden="true">
          <i />
        </span>
        <input
          className="pd-range"
          type="range"
          min={0}
          max={1000}
          step={10}
          value={Math.round(t * 1000)}
          aria-label="Library size"
          aria-valuetext={label}
          onChange={(e) => {
            touched.current = true
            setT(Number(e.target.value) / 1000)
          }}
        />
      </div>

      <div className="pd-foot">
        <ul key={plan.name} className="pd-gets">
          {plan.highlights.map((h, i) => (
            <li key={h} style={{ ['--i' as string]: i }}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 8.5 2.5 2.5L12 5.5" />
              </svg>
              {h}
            </li>
          ))}
        </ul>
        <div className="pd-actions">
          <a href="/pricing" className="link-arrow">
            Compare every plan
            <svg className="arrow" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h9m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <a href="/sign-up" className="btn btn-primary">
            {plan.cta}
          </a>
        </div>
      </div>
    </div>
  )
}
