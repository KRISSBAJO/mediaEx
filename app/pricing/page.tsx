import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import MotionRoot from '@/components/MotionRoot'
import Pricing from '@/components/Pricing'
import PriceDial from '@/components/PriceDial'
import Closing from '@/components/Closing'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Pricing — MediaEX',
  description: 'Start free with 100 GB. Every MediaEX plan includes the player, the API and global delivery.',
}

const d = (ms: number) => ({ ['--d' as string]: `${ms}ms` })

/** true = included, false = not included, a string = included with that limit */
type Cell = boolean | string
const COMPARE: { group: string; rows: [string, Cell, Cell, Cell][] }[] = [
  {
    group: 'Storage and delivery',
    rows: [
      ['Storage', '100 GB', '2 TB', '10 TB, then usage'],
      ['Global delivery', true, true, true],
      ['Dedicated edge capacity', false, false, true],
    ],
  },
  {
    group: 'Encoding and playback',
    rows: [
      ['Streaming quality', '1080p', '4K HDR', '8K, Dolby Vision'],
      ['Dolby Atmos audio', false, false, true],
      ['Transcode minutes', '50 / mo', '1,000 / mo', 'Unlimited'],
      ['Embeddable player', true, true, true],
      ['Custom player branding', false, true, true],
    ],
  },
  {
    group: 'AI and collaboration',
    rows: [
      ['Auto captions', 'English', '40+ languages', '40+ languages'],
      ['Review links', false, true, true],
      ['Version history', false, true, true],
    ],
  },
  {
    group: 'Developers',
    rows: [
      ['REST API and API keys', true, true, true],
      ['Signed webhooks', true, true, true],
      ['URL image transforms', true, true, true],
    ],
  },
  {
    group: 'Security and support',
    rows: [
      ['DRM', false, false, true],
      ['SSO and audit logs', false, false, true],
      ['Support', 'Community', 'Community', '24/7 priority'],
    ],
  },
]

const FAQ: [string, string][] = [
  [
    'What counts towards storage?',
    'The originals you upload. The renditions we make for streaming, the thumbnails and the captions are on us and never count against your plan.',
  ],
  [
    'Do you charge for bandwidth?',
    'Global delivery is part of every plan, so viewers watching your videos doesn’t add a line to your bill. That is what we mean by no egress surprises.',
  ],
  [
    'What happens when I outgrow my plan?',
    'Nothing breaks. We let you know as you get close, and you can move up a plan in a click. On Studio, storage past 10 TB is billed as you go.',
  ],
  [
    'Can I switch plans or cancel?',
    'Any time, from Settings. Moving up takes effect straight away; moving down or cancelling takes effect at the end of the period you’ve paid for.',
  ],
  ['How does yearly billing work?', 'You pay for twelve months up front and save about 20% on Pro and Studio, compared with paying monthly.'],
  [
    'Is the free plan really free?',
    'Yes. Creator has no time limit and needs no card. It includes the player, the API and delivery, the same as the paid plans.',
  ],
]

function Mark({ v }: { v: Cell }) {
  if (typeof v === 'string') return <span>{v}</span>
  return v ? (
    <svg className="cmp-yes" viewBox="0 0 16 16" role="img" aria-label="Included">
      <path d="m4 8.5 2.5 2.5L12 5.5" />
    </svg>
  ) : (
    <span className="cmp-no" role="img" aria-label="Not included">
      —
    </span>
  )
}

export default function PricingPage() {
  return (
    <>
      <MotionRoot />
      <Nav />

      <main id="top">
        <section className="section pr-hero">
          <header className="shead" data-reveal>
            <div className="shead-rule">
              <span>
                <b>05</b> Pricing
              </span>
              <span className="hide-sm">Player, API and delivery on every plan</span>
            </div>
          </header>
          <h1 className="pr-title" data-reveal style={d(80)}>
            Start free.
            <br />
            <span className="grad-text">Scale when you&apos;re ready.</span>
          </h1>
          <p className="pr-lede" data-reveal style={d(160)}>
            Three plans, one price each and no egress surprises. Start on Creator with 100 GB and move up when your library does.
          </p>
          <div className="pr-plans" data-reveal style={d(220)}>
            <Pricing />
          </div>
        </section>

        <section className="section pr-size" id="size">
          <header className="shead" data-reveal>
            <div className="shead-rule">
              <span>
                <b>A</b> Size it
              </span>
              <span className="hide-sm">Drag across your library</span>
            </div>
            <div className="shead-body">
              <h2>
                Not sure which one? <span className="grad-text">Drag to find out.</span>
              </h2>
              <p>Set how much you keep in MediaEX and the plan, the price and what you get follow along.</p>
            </div>
          </header>
          <div data-reveal>
            <PriceDial />
          </div>
        </section>

        <section className="section" id="compare">
          <header className="shead" data-reveal>
            <div className="shead-rule">
              <span>
                <b>B</b> Compare
              </span>
              <span className="hide-sm">Every plan, line by line</span>
            </div>
            <div className="shead-body">
              <h2>
                Everything in each plan. <span className="grad-text">Nothing in small print.</span>
              </h2>
            </div>
          </header>
          <div className="cmp" role="table" aria-label="Plan comparison" data-reveal>
            <div className="cmp-head" role="row">
              <span role="columnheader">
                <span className="sr-only">Feature</span>
              </span>
              <span role="columnheader">Creator</span>
              <span role="columnheader" className="is-featured">
                Pro
              </span>
              <span role="columnheader">Studio</span>
            </div>
            {COMPARE.map((g) => (
              <div key={g.group} role="rowgroup" className="cmp-group">
                <div className="cmp-group-title" role="row">
                  <span role="cell">{g.group}</span>
                </div>
                {g.rows.map(([name, ...cells]) => (
                  <div key={name} className="cmp-row" role="row">
                    <span role="rowheader">{name}</span>
                    {cells.map((c, i) => (
                      <span key={i} role="cell" className={i === 1 ? 'is-featured' : ''}>
                        <Mark v={c} />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="faq">
          <header className="shead" data-reveal>
            <div className="shead-rule">
              <span>
                <b>C</b> Questions
              </span>
            </div>
          </header>
          <div className="faq">
            <h2 className="faq-title" data-reveal>
              Asked, <span className="grad-text">and answered.</span>
            </h2>
            <div className="faq-list" data-reveal style={d(100)}>
              {FAQ.map(([q, a]) => (
                <details key={q} className="faq-item">
                  <summary>
                    {q}
                    <i aria-hidden="true" />
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <Closing secondary={{ href: '/#developers', label: 'See the API' }} />
      </main>

      <Footer />
    </>
  )
}
