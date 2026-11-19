'use client'

import { useState } from 'react'
import { PLANS } from '@/lib/plans'

export default function Pricing() {
  const [yearly, setYearly] = useState(true)

  return (
    <>
      <div className="billing" role="group" aria-label="Billing period" data-reveal>
        <button type="button" aria-pressed={!yearly} className={!yearly ? 'is-active' : ''} onClick={() => setYearly(false)}>
          Monthly
        </button>
        <button type="button" aria-pressed={yearly} className={yearly ? 'is-active' : ''} onClick={() => setYearly(true)}>
          Yearly <span className="save">−20%</span>
        </button>
        <span className="billing-thumb" style={{ transform: `translateX(${yearly ? '100%' : '0'})` }} />
      </div>
      <div className="grid-ruled plans">
        {PLANS.map((p, i) => (
          <article key={p.name} className={`plan ${p.featured ? 'is-featured' : ''}`} data-reveal style={{ ['--d' as string]: `${i * 90}ms` }}>
            <div className="plan-top">
              <h3>{p.name}</h3>
              {p.featured && <span className="plan-tag">Most popular</span>}
            </div>
            <p className="plan-blurb">{p.blurb}</p>
            <div className="plan-price">
              <span className="cur">$</span>
              <span key={`${p.name}-${yearly}`} className="amt">
                {yearly ? p.yearly : p.monthly}
              </span>
              <span className="per">/ month</span>
            </div>
            <p className="plan-note">{p.monthly === 0 ? 'Free forever' : yearly ? 'Billed yearly' : 'Billed monthly'}</p>
            <a href="/sign-up" className={`btn ${p.featured ? 'btn-primary' : 'btn-ghost'} btn-block`}>
              {p.cta}
            </a>
            <ul>
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </>
  )
}
