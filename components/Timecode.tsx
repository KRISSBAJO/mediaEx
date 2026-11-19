'use client'

import { useEffect, useRef } from 'react'

/** A running SMPTE-style timecode (HH:MM:SS:FF at 24 fps) for the hero viewfinder. */
export default function Timecode({ fps = 24, startAt = 12 }: { fps?: number; startAt?: number }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const start = performance.now()
    let raf = 0
    let lastFrame = -1
    const pad = (n: number) => String(n).padStart(2, '0')
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const t = (now - start) / 1000 + startAt
      const frame = Math.floor(t * fps)
      if (frame === lastFrame || !ref.current) return
      lastFrame = frame
      const h = Math.floor(t / 3600)
      const m = Math.floor(t / 60) % 60
      const s = Math.floor(t) % 60
      ref.current.textContent = `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frame % fps)}`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fps, startAt])

  return <span ref={ref}>00:00:{String(startAt).padStart(2, '0')}:00</span>
}
