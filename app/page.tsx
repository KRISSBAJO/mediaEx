import HeroScene from '@/components/HeroScene'
import WaveTerrain from '@/components/WaveTerrain'
import Nav from '@/components/Nav'
import MotionRoot from '@/components/MotionRoot'
import Pricing from '@/components/Pricing'
import Footer from '@/components/Footer'
import Timecode from '@/components/Timecode'
import Pipeline from '@/components/Pipeline'
import DevConsole from '@/components/DevConsole'

const BRANDS = ['Northwind Studios', 'Lumen Pictures', 'Kairo Audio', 'Halcyon', 'Driftwave', 'Orbit FM', 'Paperplane', 'Nightjar Films', 'Atlas Sports', 'Mono/Poly']

const d = (ms: number) => ({ ['--d' as string]: `${ms}ms` })

function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SectionHead({
  index,
  label,
  note,
  title,
  children,
}: {
  index: string
  label: string
  note?: string
  title?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <header className="shead" data-reveal>
      <div className="shead-rule">
        <span>
          <b>{index}</b> {label}
        </span>
        {note && <span className="hide-sm">{note}</span>}
      </div>
      {title && (
        <div className="shead-body">
          <h2>{title}</h2>
          {children && <p>{children}</p>}
        </div>
      )}
    </header>
  )
}


export default function Home() {
  return (
    <>
      <MotionRoot />
      <Nav />

      <main id="top">
        {/* ---------------- HERO ---------------- */}
        <section className="hero" aria-label="Introduction">
          <div className="viewfinder">
            <HeroScene mode="frame" />
            <span className="vf-corner tl" aria-hidden="true" />
            <span className="vf-corner tr" aria-hidden="true" />
            <span className="vf-corner bl" aria-hidden="true" />
            <span className="vf-corner br" aria-hidden="true" />
            <div className="vf-meta top" aria-hidden="true">
              <span className="vf-live">
                <i />
                Live
              </span>
              <Timecode />
            </div>
            <div className="vf-meta bottom" aria-hidden="true">
              <span>4K · 24 fps · HDR</span>
              <span className="hide-sm">Edge · Lagos → Paris → New York</span>
            </div>
          </div>
          <div className="hero-copy">
            <h1 className="hero-title hero-anim" style={d(250)}>
              Upload once.
              <br />
              <span className="grad-text">Stream everywhere.</span>
            </h1>
            <div className="hero-aside hero-anim" style={d(400)}>
              <p>
                MediaEX is the media cloud for creators and studios. Store, transcode and deliver video, audio and images
                to every screen in milliseconds.
              </p>
              <div className="hero-actions">
                <a href="/sign-up" className="btn btn-primary btn-lg">
                  Start free <Arrow />
                </a>
                <a href="#engine" className="link-arrow">
                  Watch the film <Arrow />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- BRANDS ---------------- */}
        <section className="brands" aria-label="Customers">
          <div className="brands-inner">
            <p className="brands-label">In use at 40,000+ studios, labels and channels</p>
            <div className="marquee">
              <div className="marquee-track">
                {[...BRANDS, ...BRANDS].map((b, i) => (
                  <span key={i} className="brand-name" aria-hidden={i >= BRANDS.length}>
                    {b}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- FEATURES ---------------- */}
        <section className="section" id="features">
          <SectionHead
            index="01"
            label="Platform"
            note="One file, six stops"
            title={
              <>
                Drop in a file. <span className="grad-text">Get back a media platform.</span>
              </>
            }
          >
            Everything after the upload — encoding, transforms, organising, review and delivery — runs in one pipeline you can watch,
            script and trust.
          </SectionHead>
          <Pipeline />
        </section>

        {/* ---------------- ENGINE ---------------- */}
        <section className="engine" id="engine">
          <WaveTerrain />
          <div className="engine-inner">
            <SectionHead
              index="02"
              label="Engine"
              note="Move your cursor across the field"
              title={
                <>
                  A realtime pipeline, <span className="grad-text">tuned to the millisecond.</span>
                </>
              }
            >
              GPU encoders at the edge, a global cache and an AI layer that watches every frame.
            </SectionHead>
            <div className="stats">
              {[
                { n: 38, s: 'ms', l: 'Median time to first frame' },
                { n: 12, s: '×', l: 'Faster than real-time encoding' },
                { n: 40, s: '+', l: 'Caption and dub languages' },
                { n: 99.99, s: '%', l: 'Uptime across all regions', dec: 2 },
              ].map((s, i) => (
                <div key={s.l} className="stat" data-reveal style={d(i * 90)}>
                  <p>{s.l}</p>
                  <div className="stat-num">
                    <span data-count={s.n} data-decimals={s.dec ?? 0}>
                      0
                    </span>
                    <em>{s.s}</em>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- WORKFLOW ---------------- */}
        <section className="section" id="workflow">
          <SectionHead
            index="03"
            label="Workflow"
            note="Raw file to every screen"
            title={
              <>
                Three steps. <span className="grad-text">No render queue.</span>
              </>
            }
          >
            Upload from anywhere, let the pipeline do the work in parallel, and ship one playback URL to every screen.
          </SectionHead>
          <div className="steps" data-progress>
            <div className="steps-line">
              <i />
            </div>
            {[
              {
                t: 'Upload',
                p: 'Drop files in the browser, sync a folder, or push from your camera, DAW or NLE through the API.',
                k: 'mx upload ./footage',
              },
              {
                t: 'Process',
                p: 'MediaEX encodes, captions, tags and packages every asset in parallel on GPUs close to you.',
                k: 'av1 · hevc · captions',
              },
              {
                t: 'Deliver',
                p: 'Embed the player, share a review link, or stream to apps and TVs with one playback URL.',
                k: 'play.mediaex.io/a8f2',
              },
            ].map((s, i) => (
              <div key={s.t} className="step" data-reveal style={d(i * 140)}>
                <span className="step-num">
                  0{i + 1} <i>/ 03</i>
                </span>
                <h3>{s.t}</h3>
                <p>{s.p}</p>
                <code>{s.k}</code>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- DEVELOPERS ---------------- */}
        <section className="section" id="developers">
          <SectionHead
            index="04"
            label="Developers"
            note="REST · Webhooks · Transforms"
            title={
              <>
                Ship video features <span className="grad-text">in an afternoon.</span>
              </>
            }
          >
            Everything the dashboard does, from your own code: scoped API keys, a REST API, signed webhooks and URL transforms.
          </SectionHead>
          <div data-reveal>
            <DevConsole />
          </div>
          <div className="dev-specs" data-reveal style={d(120)}>
            {[
              ['API keys', 'Scoped to read, upload or full access. Revoke any key instantly.', 'mx_live_••••'],
              ['REST API', 'List, search, upload, edit and delete assets.', '/api/v1'],
              ['Webhooks', 'Six asset events, signed and retried for a day.', 'HMAC-SHA256'],
              ['Transforms', 'Any size, crop or format, straight from a URL.', '?w=1200&f=avif'],
            ].map(([t, x, k]) => (
              <div key={t} className="dev-spec">
                <b>{t}</b>
                <p>{x}</p>
                <code>{k}</code>
              </div>
            ))}
          </div>
          <div className="dev-actions" data-reveal style={d(200)}>
            <a href="/dashboard/developers" className="btn btn-primary">
              Create an API key <Arrow />
            </a>
            <a href="/dashboard/developers" className="link-arrow">
              Read the docs <Arrow />
            </a>
          </div>
        </section>

        {/* ---------------- PRICING ---------------- */}
        <section className="section" id="pricing">
          <SectionHead
            index="05"
            label="Pricing"
            note="Player, API and delivery on every plan"
            title={
              <>
                Start free. <span className="grad-text">Scale when you&apos;re ready.</span>
              </>
            }
          >
            No egress surprises. Every plan includes the player, the API and global delivery.
          </SectionHead>
          <Pricing />
        </section>

        {/* ---------------- CTA ---------------- */}
        <section className="section cta-wrap">
          <div className="cta" data-reveal>
            <span className="vf-corner tl" aria-hidden="true" />
            <span className="vf-corner tr" aria-hidden="true" />
            <span className="vf-corner bl" aria-hidden="true" />
            <span className="vf-corner br" aria-hidden="true" />
            <div className="vf-meta top" aria-hidden="true">
              <span className="vf-live">
                <i />
                Rolling
              </span>
              <span>Take 01</span>
            </div>
            <h2>
              Your next release
              <br />
              <span className="grad-text">starts with one upload.</span>
            </h2>
            <div className="cta-side">
              <p>Free forever plan. No card required. Bring your first 100 GB today.</p>
              <div className="hero-actions">
                <a href="/sign-up" className="btn btn-primary btn-lg">
                  Start free <Arrow />
                </a>
                <a href="#pricing" className="link-arrow">
                  Book a demo <Arrow />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  )
}
