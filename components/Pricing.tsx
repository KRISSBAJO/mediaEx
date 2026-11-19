'use client'

import { useState } from 'react'

const PLANS = [
  {
    name: 'Creator',
    blurb: 'For solo creators getting started.',
    monthly: 0,
    yearly: 0,
    cta: 'Start free',
    features: ['100 GB storage', '1080p streaming', '50 transcode minutes / mo', 'Auto captions (EN)', 'Community support'],
  },
  {
    name: 'Pro',
    blurb: 'For creators and small teams shipping weekly.',
    monthly: 24,
    yearly: 19,
    cta: 'Go Pro',
    featured: true,
    features: [
      '2 TB storage',
      '4K HDR streaming',
      '1,000 transcode minutes / mo',
      'AI Studio: 40+ caption languages',
      'Review links & version history',
      'Custom player branding',
    ],
  },
  {
    name: 'Studio',
    blurb: 'For studios and media teams at scale.',
    monthly: 99,
    yearly: 79,
    cta: 'Talk to us',
    features: [
      '10 TB storage, then pay as you go',
      '8K, Dolby Vision & Atmos',
      'Unlimited transcoding',
      'DRM, SSO & audit logs',
      'Dedicated edge capacity',
      '24/7 priority support',
    ],
  },
]

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
            <a href={p.name === 'Studio' ? '#top' : '/sign-up'} className={`btn ${p.featured ? 'btn-primary' : 'btn-ghost'} btn-block`}>
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
