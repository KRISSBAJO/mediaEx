import HeroScene from '@/components/HeroScene'
import WaveTerrain from '@/components/WaveTerrain'
import Nav from '@/components/Nav'
import MotionRoot from '@/components/MotionRoot'
import Pricing from '@/components/Pricing'
import Logo from '@/components/Logo'
import Timecode from '@/components/Timecode'

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

function CellTag({ n, t }: { n: string; t: string }) {
  return (
    <span className="cell-tag">
      <b>{n}</b> {t}
    </span>
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
              Stream everywhere.
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
            <p className="mono-label">In use at 40,000+ studios, labels and channels</p>
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
            note="Six capabilities, one pipeline"
            title={
              <>
                One home for every frame, <span className="grad-text">track and pixel.</span>
              </>
            }
          >
            From the first upload to the last viewer, MediaEX handles the heavy lifting so you can stay in the creative flow.
          </SectionHead>

          <div className="grid-ruled bento">
            <article className="cell b-upload" data-reveal style={d(0)}>
              <CellTag n="01" t="Ingest" />
              <div className="viz viz-upload">
                {[
                  ['MOV', 'launch_film_final.mov', '8.4 GB · ProRes 4444'],
                  ['WAV', 'podcast_ep_112.wav', '1.2 GB · 96 kHz'],
                  ['RAW', 'campaign_stills.zip', '3.1 GB · 214 files'],
                ].map(([ext, name, meta], i) => (
                  <div key={name} className="file" style={d(i * 600)}>
                    <span className="file-ext">{ext}</span>
                    <div className="file-body">
                      <div className="file-row">
                        <b>{name}</b>
                        <span>{meta}</span>
                      </div>
                      <div className="bar">
                        <i />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <h3>Drag. Drop. Done.</h3>
              <p>Resumable uploads up to 5 TB per file. 8K RAW, ProRes, FLAC, HEIC — if it plays, MediaEX takes it.</p>
            </article>

            <article className="cell b-transcode" data-reveal style={d(80)}>
              <CellTag n="02" t="Encode" />
              <div className="viz viz-codecs">
                {['AV1', 'HEVC', 'H.264', 'VP9', 'ProRes', 'Opus', 'AAC', 'WebP'].map((c, i) => (
                  <span key={c} style={d(i * 350)}>
                    {c}
                  </span>
                ))}
              </div>
              <h3>Smart transcoding</h3>
              <p>Per-title encoding picks the best ladder for every asset. Up to 50% smaller at the same quality.</p>
            </article>

            <article className="cell b-edge" data-reveal style={d(0)}>
              <CellTag n="03" t="Deliver" />
              <div className="viz viz-map">
                {[
                  [18, 38],
                  [27, 30],
                  [47, 28],
                  [52, 46],
                  [70, 34],
                  [80, 60],
                  [34, 66],
                  [62, 70],
                ].map(([x, y], i) => (
                  <span key={i} className="pop" style={{ left: `${x}%`, top: `${y}%`, ...d(i * 420) }} />
                ))}
                <span className="viz-note">190+ PoPs</span>
              </div>
              <h3>Global edge streaming</h3>
              <p>Adaptive HLS and DASH from 190+ locations, with a median start time of 38 ms.</p>
            </article>

            <article className="cell b-ai" data-reveal style={d(80)}>
              <CellTag n="04" t="Understand" />
              <div className="viz viz-ai">
                <div className="frame">
                  <span className="scene-tag">SC 04 · Beach · Dusk</span>
                  <div className="caption">
                    <span>&quot;We finally made it to the coast.&quot;</span>
                  </div>
                </div>
                <div className="langs">
                  {['EN', 'ES', 'JA', 'DE', 'PT', 'HI', '+34'].map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                </div>
              </div>
              <h3>AI Studio</h3>
              <p>Captions in 40+ languages, scene detection, smart thumbnails and search that knows what is on screen.</p>
            </article>

            <article className="cell b-review" data-reveal style={d(0)}>
              <CellTag n="05" t="Review" />
              <div className="viz viz-review">
                <div className="avatars">
                  {['AK', 'JR', 'ML', 'SO'].map((a) => (
                    <span key={a}>{a}</span>
                  ))}
                </div>
                <div className="timeline">
                  <i className="playhead" />
                  {[14, 38, 61, 83].map((x, i) => (
                    <b key={x} style={{ left: `${x}%`, ...d(i * 300) }} />
                  ))}
                </div>
                <div className="comment">
                  <span>ML</span>
                  <em>00:00:42:06</em> Tighten this cut by 6 frames?
                </div>
              </div>
              <h3>Review &amp; approve</h3>
              <p>Frame-accurate comments, version stacks and one-click approvals your clients will actually use.</p>
            </article>

            <article className="cell b-analytics" data-reveal style={d(80)}>
              <CellTag n="06" t="Measure" />
              <div className="viz viz-chart">
                {[42, 58, 50, 72, 64, 86, 78, 94, 70, 88, 100, 92].map((h, i) => (
                  <i key={i} style={{ ['--h' as string]: `${h}%`, ...d(i * 70) }} />
                ))}
              </div>
              <h3>Real-time analytics</h3>
              <p>Watch time, quality of experience and retention heatmaps, live as people press play.</p>
            </article>
          </div>
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
          />
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
          <SectionHead index="04" label="Developers" note="REST · GraphQL · Webhooks" />
          <div className="dev">
            <div className="dev-copy" data-reveal>
              <h2>
                Ship video features <span className="grad-text">in an afternoon.</span>
              </h2>
              <p>A typed SDK, REST and GraphQL APIs, webhooks for every event and a drop-in player that works everywhere.</p>
              <ul className="dev-list">
                {['SDKs for JavaScript, Swift, Kotlin and Python', 'Signed URLs, DRM and token auth', 'Webhooks for every pipeline event', 'Open-source, themeable player'].map(
                  (x) => (
                    <li key={x}>{x}</li>
                  ),
                )}
              </ul>
              <a href="#pricing" className="link-arrow">
                Read the docs <Arrow />
              </a>
            </div>
            <div className="code" data-reveal style={d(120)}>
              <div className="code-bar">
                <span className="code-tab is-active">upload.ts</span>
                <span className="code-tab">webhook.ts</span>
                <span className="code-lang">TypeScript</span>
              </div>
              <pre>
                <code>
                  <span className="k">import</span> {'{ MediaEX }'} <span className="k">from</span> <span className="s">&apos;@mediaex/sdk&apos;</span>
                  {'\n\n'}
                  <span className="k">const</span> mx = <span className="k">new</span> <span className="f">MediaEX</span>({'{ '}apiKey: process.env.<span className="c2">MEDIAEX_KEY</span>
                  {' })'}
                  {'\n\n'}
                  <span className="k">const</span> asset = <span className="k">await</span> mx.assets.<span className="f">upload</span>(<span className="s">&apos;./launch-film.mov&apos;</span>, {'{'}
                  {'\n'}
                  {'  '}renditions: [<span className="s">&apos;2160p&apos;</span>, <span className="s">&apos;1080p&apos;</span>, <span className="s">&apos;720p&apos;</span>],
                  {'\n'}
                  {'  '}codecs: [<span className="s">&apos;av1&apos;</span>, <span className="s">&apos;hevc&apos;</span>],
                  {'\n'}
                  {'  '}captions: {'{ '}auto: <span className="c2">true</span>, languages: [<span className="s">&apos;en&apos;</span>, <span className="s">&apos;es&apos;</span>, <span className="s">&apos;ja&apos;</span>]{' }'},
                  {'\n'}
                  {'})'}
                  {'\n\n'}
                  <span className="cm">{'// → https://play.mediaex.io/a8f2c91e'}</span>
                  {'\n'}
                  console.<span className="f">log</span>(asset.playbackUrl)
                </code>
              </pre>
              <div className="code-out">
                <span>
                  <i className="ok" /> Ready in 41s
                </span>
                <span>8.4 GB · 3 renditions · 3 caption tracks</span>
              </div>
            </div>
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

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <a href="#top" className="brand">
              <Logo />
              <span>
                Media<b>EX</b>
              </span>
            </a>
            <p>The media cloud for creators and studios.</p>
          </div>
          {[
            { h: 'Product', l: ['Upload', 'Transcoding', 'Streaming', 'AI Studio', 'Analytics'] },
            { h: 'Developers', l: ['Docs', 'API reference', 'SDKs', 'Player', 'Status'] },
            { h: 'Company', l: ['About', 'Customers', 'Careers', 'Blog', 'Contact'] },
          ].map((c) => (
            <div key={c.h} className="footer-col">
              <h4>{c.h}</h4>
              {c.l.map((x) => (
                <a key={x} href="#top">
                  {x}
                </a>
              ))}
            </div>
          ))}
        </div>
        <div className="footer-mark" aria-hidden="true">
          MediaEX
        </div>
        <div className="footer-base">
          <span>© {new Date().getFullYear()} MediaEX, Inc.</span>
          <span>
            <i className="status-dot" /> All systems operational
          </span>
        </div>
      </footer>
    </>
  )
}
