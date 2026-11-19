import HeroScene from '@/components/HeroScene'
import WaveTerrain from '@/components/WaveTerrain'
import Nav from '@/components/Nav'
import MotionRoot from '@/components/MotionRoot'
import Pricing from '@/components/Pricing'
import Logo from '@/components/Logo'

const BRANDS = ['Northwind Studios', 'Lumen Pictures', 'Kairo Audio', 'Halcyon', 'Driftwave', 'Orbit FM', 'Paperplane', 'Nightjar Films', 'Atlas Sports', 'Mono/Poly']

const d = (ms: number) => ({ ['--d' as string]: `${ms}ms` })

function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Home() {
  return (
    <>
      <HeroScene />
      <MotionRoot />
      <Nav />

      <main id="top">
        {/* ---------------- HERO ---------------- */}
        <section className="hero">
          <div className="hero-inner">
            <a href="#engine" className="pill hero-in" style={d(100)}>
              <span className="pill-dot" />
              <span>New</span>
              MediaEX 2.0 with AI Studio
              <Arrow />
            </a>
            <h1 className="hero-title">
              <span className="line">
                <span className="hero-word" style={d(200)}>
                  Upload once.
                </span>
              </span>
              <span className="line">
                <span className="hero-word grad-text" style={d(320)}>
                  Stream everywhere.
                </span>
              </span>
            </h1>
            <p className="hero-sub hero-in" style={d(480)}>
              MediaEX is the media cloud for creators and teams. Store, transcode, edit and deliver video, audio and images
              to every screen on the planet in milliseconds.
            </p>
            <div className="hero-ctas hero-in" style={d(600)}>
              <a href="#pricing" className="btn btn-primary btn-lg">
                Start free <Arrow />
              </a>
              <a href="#engine" className="btn btn-ghost btn-lg">
                <span className="play-dot">
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M4 2.5v7l5.5-3.5L4 2.5Z" fill="currentColor" />
                  </svg>
                </span>
                Watch the demo
              </a>
            </div>
            <ul className="hero-meta hero-in" style={d(720)}>
              <li>
                <b>8K</b> HDR &amp; Dolby Atmos
              </li>
              <li>
                <b>190+</b> edge locations
              </li>
              <li>
                <b>99.99%</b> uptime SLA
              </li>
            </ul>
          </div>
          <p className="hero-hint hero-in" style={d(1100)}>
            <span className="mouse" /> Move, scroll or click the orb
          </p>
        </section>

        {/* ---------------- BRANDS ---------------- */}
        <section className="brands" aria-label="Customers">
          <p>Trusted by 40,000+ creators, labels and studios</p>
          <div className="marquee">
            <div className="marquee-track">
              {[...BRANDS, ...BRANDS].map((b, i) => (
                <span key={i} className="brand-chip" aria-hidden={i >= BRANDS.length}>
                  <i style={{ ['--h' as string]: `${(i * 37) % 360}` }} />
                  {b}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- FEATURES ---------------- */}
        <section className="section" id="features">
          <div className="section-head" data-reveal>
            <span className="eyebrow">The platform</span>
            <h2>
              One home for every <span className="grad-text">frame, track and pixel</span>
            </h2>
            <p>From the first upload to the last viewer, MediaEX handles the heavy lifting so you can stay in the creative flow.</p>
          </div>

          <div className="bento">
            <article className="card spot b-upload" data-reveal style={d(0)}>
              <div className="viz viz-upload">
                {[
                  ['launch_film_final.mov', '8.4 GB', 'ProRes 4444'],
                  ['podcast_ep_112.wav', '1.2 GB', '96 kHz'],
                  ['campaign_stills.zip', '3.1 GB', '214 RAW'],
                ].map(([name, size, meta], i) => (
                  <div key={name} className="file" style={d(i * 600)}>
                    <span className={`file-ico ico-${i}`} />
                    <div className="file-body">
                      <div className="file-row">
                        <b>{name}</b>
                        <span>
                          {size} · {meta}
                        </span>
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

            <article className="card spot b-transcode" data-reveal style={d(80)}>
              <div className="viz viz-codecs">
                {['AV1', 'HEVC', 'H.264', 'VP9', 'ProRes', 'Opus', 'AAC', 'WebP'].map((c, i) => (
                  <span key={c} style={d(i * 350)}>
                    {c}
                  </span>
                ))}
              </div>
              <h3>Smart transcoding</h3>
              <p>Per-title encoding picks the best ladder for every asset. Up to 50% smaller files at the same quality.</p>
            </article>

            <article className="card spot b-edge" data-reveal style={d(160)}>
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
              </div>
              <h3>Global edge streaming</h3>
              <p>Adaptive HLS and DASH from 190+ locations, with a median start time of 38 ms.</p>
            </article>

            <article className="card spot b-ai" data-reveal style={d(0)}>
              <div className="viz viz-ai">
                <div className="frame">
                  <span className="scene-tag">Scene 04 · Beach · Sunset</span>
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
              <p>Captions in 40+ languages, scene detection, smart thumbnails and search that understands what is on screen.</p>
            </article>

            <article className="card spot b-review" data-reveal style={d(80)}>
              <div className="viz viz-review">
                <div className="avatars">
                  {['var(--violet)', 'var(--cyan)', 'var(--pink)', 'var(--b-soft)'].map((c, i) => (
                    <span key={c} style={{ background: c }}>
                      {['AK', 'JR', 'ML', 'SO'][i]}
                    </span>
                  ))}
                </div>
                <div className="timeline">
                  <i className="playhead" />
                  {[14, 38, 61, 83].map((x, i) => (
                    <b key={x} style={{ left: `${x}%`, ...d(i * 300) }} />
                  ))}
                </div>
                <div className="comment">
                  <span>ML</span> 00:42 — tighten this cut by 6 frames?
                </div>
              </div>
              <h3>Review &amp; approve</h3>
              <p>Frame-accurate comments, version stacks and one-click approvals your clients will actually use.</p>
            </article>

            <article className="card spot b-analytics" data-reveal style={d(160)}>
              <div className="viz viz-chart">
                {[42, 58, 50, 72, 64, 86, 78, 94, 70, 88, 100, 92].map((h, i) => (
                  <i key={i} style={{ ['--h' as string]: `${h}%`, ...d(i * 70) }} />
                ))}
              </div>
              <h3>Real-time analytics</h3>
              <p>Watch time, quality of experience and audience retention heatmaps, live as people press play.</p>
            </article>
          </div>
        </section>

        {/* ---------------- ENGINE ---------------- */}
        <section className="engine" id="engine">
          <WaveTerrain />
          <div className="engine-inner">
            <div className="section-head" data-reveal>
              <span className="eyebrow">The MediaEX Engine</span>
              <h2>
                A realtime pipeline, <span className="grad-text">tuned to the millisecond</span>
              </h2>
              <p>
                GPU encoders at the edge, a global cache and an AI layer that watches every frame. Move your cursor over the
                field to send a ripple through it.
              </p>
            </div>
            <div className="stats">
              {[
                { n: 38, s: 'ms', l: 'median time to first frame' },
                { n: 12, s: 'x', l: 'faster than real-time encoding' },
                { n: 40, s: '+', l: 'caption and dub languages' },
                { n: 99.99, s: '%', l: 'uptime across all regions', dec: 2 },
              ].map((s, i) => (
                <div key={s.l} className="stat" data-reveal style={d(i * 90)}>
                  <div className="stat-num">
                    <span data-count={s.n} data-decimals={s.dec ?? 0}>
                      0
                    </span>
                    <em>{s.s}</em>
                  </div>
                  <p>{s.l}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- WORKFLOW ---------------- */}
        <section className="section" id="workflow">
          <div className="section-head" data-reveal>
            <span className="eyebrow">How it works</span>
            <h2>
              From raw file to <span className="grad-text">every screen</span> in three steps
            </h2>
          </div>
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
                <span className="step-num">0{i + 1}</span>
                <h3>{s.t}</h3>
                <p>{s.p}</p>
                <code>{s.k}</code>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- DEVELOPERS ---------------- */}
        <section className="section dev" id="developers">
          <div className="dev-copy" data-reveal>
            <span className="eyebrow">For developers</span>
            <h2>
              Ship video features in <span className="grad-text">an afternoon</span>
            </h2>
            <p>A typed SDK, REST and GraphQL APIs, webhooks for every event and a drop-in player that works everywhere.</p>
            <ul className="dev-list">
              {['SDKs for JavaScript, Swift, Kotlin and Python', 'Signed URLs, DRM and token auth', 'Webhooks for every pipeline event', 'Open-source, themeable player'].map(
                (x) => (
                  <li key={x}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {x}
                  </li>
                ),
              )}
            </ul>
            <a href="#pricing" className="btn btn-ghost">
              Read the docs <Arrow />
            </a>
          </div>
          <div className="code spot" data-reveal style={d(120)}>
            <div className="code-bar">
              <i />
              <i />
              <i />
              <span>upload.ts</span>
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
              <span className="ok">●</span> Uploaded 8.4 GB · 3 renditions · captions in 3 languages · <b>ready in 41s</b>
            </div>
          </div>
        </section>

        {/* ---------------- PRICING ---------------- */}
        <section className="section" id="pricing">
          <div className="section-head center" data-reveal>
            <span className="eyebrow">Pricing</span>
            <h2>
              Start free. <span className="grad-text">Scale when you&apos;re ready.</span>
            </h2>
            <p>No egress surprises. Every plan includes the player, the API and global delivery.</p>
          </div>
          <Pricing />
        </section>

        {/* ---------------- CTA ---------------- */}
        <section className="section">
          <div className="cta spot" data-reveal>
            <div className="cta-glow" />
            <h2>
              Ready to make your <span className="grad-text">media move?</span>
            </h2>
            <p>Join 40,000+ creators and studios streaming with MediaEX. Free forever plan, no card required.</p>
            <div className="hero-ctas center">
              <a href="#pricing" className="btn btn-primary btn-lg">
                Start free <Arrow />
              </a>
              <a href="#pricing" className="btn btn-ghost btn-lg">
                Book a demo
              </a>
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
            <p>The media cloud for creators and teams.</p>
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
        <div className="footer-base">
          <span>© {new Date().getFullYear()} MediaEX. All rights reserved.</span>
          <span>
            <i className="status-dot" /> All systems operational
          </span>
        </div>
      </footer>
    </>
  )
}
