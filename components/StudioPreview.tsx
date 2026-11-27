'use client'

import { useEffect, useRef, useState } from 'react'
import HeroScene from './HeroScene'
import WaveTerrain from './WaveTerrain'
import styles from './StudioPreview.module.css'

const clip = '/tour/flower.mp4'
const views = ['Library', 'Review', 'Delivery'] as const
const chapters = ['Upload', 'Captions', 'Playback'] as const
const durations = [6000, 7000, 7000]

export default function StudioPreview() {
  const [stage, setStage] = useState(-1)
  const [running, setRunning] = useState(false)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState<typeof views[number]>('Library')
  const remaining = useRef(0)
  useEffect(() => {
    remaining.current = durations[stage] ?? 0
  }, [stage])
  useEffect(() => {
    if (!running || stage < 0 || stage >= chapters.length) return
    const started = performance.now()
    const timer = window.setTimeout(() => setStage(stage + 1), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (performance.now() - started))
    }
  }, [stage, running])
  return <><div className={styles.shell}>
    <section className={styles.hero} aria-labelledby="studio-title">
      <div className={styles.copy}>
        <h1 id="studio-title">Upload once.<br /><em>Ready to share.</em></h1>
        <p>Bring your footage into MediaEX, review it with your team, and share a player that works across screens.</p>
        <a className="btn btn-primary btn-lg" href="/sign-up">Start free <span aria-hidden="true">↗</span></a>
      </div>
      <div id="tour" className={styles.tour} aria-label="MediaEX product tour">
        <div className={styles.screen}>
          {stage === -1 ? <img className={styles.video} src="/tour/media-signal.webp" alt="" fetchPriority="high" /> : <video key={stage === chapters.length ? "sample" : "tour"} className={styles.video} aria-label="Flower field sample film" poster="/tour/media-signal.webp"
            preload="auto" playsInline muted autoPlay={stage < chapters.length} loop={stage < chapters.length} controls
            onPlaying={() => setRunning(true)} onWaiting={() => setRunning(false)} onPause={() => setRunning(false)}
            onError={() => { setFailed(true); setRunning(false) }}>
            <source src="/tour/flower.webm" type="video/webm" />
            <source src={clip} type="video/mp4" onError={() => { setFailed(true); setRunning(false) }} />
          </video>}
          {stage === -1 && <button className={styles.play} onClick={() => { setFailed(false); setStage(0) }}>
            <span className={styles.prism}><HeroScene mode="panel" /></span>
            <span className={styles.playLabel}>▶ &nbsp; Watch the tour · 20 sec</span>
          </button>}
          {stage >= 0 && stage < 3 && <>
            <button className={styles.close} aria-label="Close tour" onClick={() => { setRunning(false); setStage(-1) }}>×</button>
            {failed ? <p className={styles.scene} role="alert">Video unavailable. <a href={clip}>Open the sample film</a></p> : <div className={styles.scene} key={stage}>
              {stage === 0 ? <><small>Library / New asset</small><b>Flower field.mp4</b><div className={styles.progress} /></> :
               stage === 1 ? <><small>Caption preview · 00:02</small><b>[A breeze moves through the flowers.]</b></> :
               <><small>Published player</small><b>Flower field</b></>}
            </div>}
          </>}
        </div>
        <div className={styles.strip}>
          {stage === -1 ? <><b>MediaEX product tour</b></> : stage === 3 ?
            <><b>Play the sample film</b><button onClick={() => { setFailed(false); setStage(0) }}>Replay tour ↺</button></> :
            chapters.map((name,i) => <button key={name} aria-pressed={stage === i} onClick={() => setStage(i)}>{name}</button>)}
        </div>
      </div>
    </section>
    </div>
    <section className="engine" id="engine" aria-labelledby="engine-title">
      <WaveTerrain />
      <div className="engine-inner">
        <header className="shead">
          <div className="shead-rule"><span>Engine</span><span className="hide-sm">Move your cursor across the field</span></div>
          <div className="shead-body">
            <h2 id="engine-title">A realtime pipeline, <span className="grad-text">tuned to the millisecond.</span></h2>
            <p>Parallel encoding ladders, uploads that survive a dropped connection, and a player that reports every stall.</p>
          </div>
        </header>
        <div className="stats">
          {[
            ['Codecs per video: H.264, HEVC and AV1', '3', ''],
            ['Per upload, resumable in parts', '50', 'GB'],
            ['Top streaming resolution, on Studio', '8', 'K'],
            ['Signed webhook events', '7', ''],
          ].map(([label, value, unit]) => <div className="stat" key={label}>
            <p>{label}</p><div className="stat-num">{value}<em>{unit}</em></div>
          </div>)}
        </div>
      </div>
    </section>
    <div className={styles.shell}>
    <section className={styles.workspace} id="features" aria-labelledby="workspace-title">
      <div className={styles.workspaceHead}><h2 id="workspace-title">Inside the workspace</h2>
        <div className={styles.switcher} aria-label="Workspace view">{views.map(name =>
          <button key={name} aria-pressed={view === name} onClick={() => setView(name)}>{name}</button>)}</div>
      </div>
      <div className={styles.window}>
        <div className={styles.toolbar}><b>Media library</b><span>/</span> Live sessions <span>/</span> Stage left</div>
        <div className={styles.detail}>
          <div className={styles.preview}><img className={styles.video} src="/tour/live-session.webp" alt="A guitarist lit by amber stage lights against teal concert haze" width="1600" height="682" loading="lazy" /></div>
          <div className={styles.inspector}>
            <small>{view === 'Library' ? 'Asset details' : view === 'Review' ? 'Photo review' : 'Image delivery'}</small>
            <h3>{view === 'Library' ? 'Stage left.webp' : view === 'Review' ? 'Stage lighting' : 'Stage left'}</h3>
            {view === 'Library' ? <dl><dt>Collection</dt><dd>Live sessions</dd><dt>Version</dt><dd>Original</dd><dt>Format</dt><dd>WebP image</dd></dl> :
             view === 'Review' ? <><p>Keep the wide crop so the guitar and the stage lighting stay in frame.</p></> :
             <><p>Open the full-size image to inspect the delivered file.</p><a href="/tour/live-session.webp" target="_blank" rel="noreferrer">Open image ↗</a></>}
          </div>
        </div>
      </div>
    </section>
  </div></>
}
