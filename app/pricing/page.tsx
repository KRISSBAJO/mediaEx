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
    group: 'Storage and uploads',
    rows: [
      ['Storage (originals and everything made from them)', '100 GB', '2 TB', '10 TB, no hard cap'],
      ['Processing minutes a month', '50', '1,000', 'Unlimited'],
      ['Uploads up to 50 GB, resumable', true, true, true],
    ],
  },
  {
    group: 'Encoding and playback',
    rows: [
      ['Top streaming resolution', '1080p', '4K', '8K'],
      ['H.264 adaptive streaming (HLS)', true, true, true],
      ['HEVC and AV1 encoding', false, true, true],
      ['Embeddable player and share links', true, true, true],
      ['Signed playback links', true, true, true],
      ['Global delivery, no bandwidth fees', true, true, true],
    ],
  },
  {
    group: 'Captions and library',
    rows: [
      ['Automatic captions (spoken language detected)', true, true, true],
      ['Upload your own captions (VTT, SRT)', true, true, true],
      ['Folders, collections, tags, custom fields', true, true, true],
      ['Moderation and review queue', true, true, true],
    ],
  },
  {
    group: 'Developers and insight',
    rows: [
      ['REST API with scoped keys', true, true, true],
      ['Signed webhooks', true, true, true],
      ['URL image transforms', true, true, true],
      ['View analytics', true, true, true],
    ],
  },
]

const FAQ: [string, string][] = [
  [
    'What counts towards storage?',
    'The originals you upload and everything the pipeline makes from them: the streaming renditions, thumbnails, posters and captions. Settings → Billing shows where you are.',
  ],
  [
    'Do you charge for bandwidth?',
    'No. Delivery is part of every plan, so people watching your videos never adds to your bill. That is what we mean by no egress surprises.',
  ],
  [
    'What happens when I reach a limit?',
    'Everything you already have keeps streaming. On Creator and Pro, new uploads pause when storage is full or the month’s processing minutes are used, until you upgrade, free up space or the month resets. Studio has unlimited minutes and no hard storage cap.',
  ],
  [
    'What are processing minutes?',
    'The length of each video and audio file the pipeline processes in a billing period. A 10-minute video uses 10 minutes, whichever codecs it’s encoded in. Images don’t count.',
  ],
  [
    'How do I upgrade or cancel?',
    'From Settings → Billing in your dashboard. Cancelling keeps your plan until the end of the period you’ve paid for, then the workspace moves to Creator.',
  ],
  ['How does yearly billing work?', 'You pay for twelve months up front: $228 instead of $288 for Pro, and $948 instead of $1,188 for Studio.'],
  [
    'Is the free plan really free?',
    'Yes. Creator has no time limit and needs no card. It includes the player, the API, webhooks, captions and analytics, the same as the paid plans.',
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
