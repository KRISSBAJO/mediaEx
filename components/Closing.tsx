'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import Timecode from './Timecode'

/**
 * The closing call to action on the landing and pricing pages: a full-width headline and a real drop target.
 * Dropping (or choosing) a file doesn't upload anything. It names the file and points at sign-up, where the upload happens.
 */
const LINE_1 = ['Your', 'next', 'release']
const LINE_2 = ['starts', 'with', 'one', 'upload.']

const size = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`

function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Closing({ secondary = { href: '/pricing', label: 'See pricing' } }: { secondary?: { href: string; label: string } }) {
  const [over, setOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // light the target up as soon as a file is dragged anywhere over the page
  useEffect(() => {
    let depth = 0
    const hasFile = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFile(e)) return
      depth++
      setOver(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const end = () => {
      depth = 0
      setOver(false)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', end)
    window.addEventListener('dragend', end)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', end)
      window.removeEventListener('dragend', end)
    }
  }, [])

  const words = (list: string[], from: number) =>
    list.map((w, i) => (
      <Fragment key={w}>
        <span className="cl-word">
          <span style={{ ['--w' as string]: from + i }}>{w}</span>
        </span>{' '}
      </Fragment>
    ))

  return (
    <section className="closing" aria-labelledby="closing-title">
      <div className="cl-frame" data-reveal>
        <span className="cl-leak" aria-hidden="true" />
        <span className="vf-corner tl" aria-hidden="true" />
        <span className="vf-corner tr" aria-hidden="true" />
        <span className="vf-corner bl" aria-hidden="true" />
        <span className="vf-corner br" aria-hidden="true" />
        <div className="vf-meta top" aria-hidden="true">
          <span className="vf-live">
            <i />
            Rolling
          </span>
          <span>
            Take 01 · <Timecode startAt={0} />
          </span>
        </div>

        <h2 id="closing-title" className="cl-title">
          <span className="cl-line">{words(LINE_1, 0)}</span>
          <span className="cl-line grad-text">{words(LINE_2, LINE_1.length)}</span>
        </h2>

        <div className="cl-body">
          <div
            className={`cl-drop ${over ? 'is-over' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) setFile(f)
            }}
          >
            <input
              ref={input}
              type="file"
              accept="video/*,audio/*,image/*"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <>
                <span className="cl-drop-icon is-done" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="m6 12.5 4 4 8-9" />
                  </svg>
                </span>
                <span className="cl-drop-text" role="status">
                  <b className="mono">{file.name}</b>
                  <span>{size(file.size)} · ready to go. Create a free account to upload it.</span>
                </span>
                <a href="/sign-up" className="btn btn-primary">
                  Continue <Arrow />
                </a>
              </>
            ) : (
              <button type="button" className="cl-drop-hit" onClick={() => input.current?.click()}>
                <span className="cl-drop-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 16V5m-5 5 5-5 5 5M5 19h14" />
                  </svg>
                </span>
                <span className="cl-drop-text">
                  <b>{over ? 'Let go to start your library' : 'Drop your first file here'}</b>
                  <span>or click to choose a video, song or image</span>
                </span>
              </button>
            )}
          </div>

          <div className="cl-side">
            <p>Free forever plan. No card required. Bring your first 100 GB today.</p>
            <div className="hero-actions">
              <a href="/sign-up" className="btn btn-primary btn-lg">
                Start free <Arrow />
              </a>
              <a href={secondary.href} className="link-arrow">
                {secondary.label} <Arrow />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
