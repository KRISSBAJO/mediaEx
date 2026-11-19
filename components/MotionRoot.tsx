'use client'

import { useEffect } from 'react'

/** Wires up scroll reveals, counters, cursor spotlights and scroll-linked progress for the whole page. */
export default function MotionRoot() {
  useEffect(() => {
    const root = document.documentElement
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    root.classList.add('motion')

    const reveal = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-in')
            reveal.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    )
    document.querySelectorAll('[data-reveal]').forEach((el) => reveal.observe(el))

    const counters = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return
          counters.unobserve(e.target)
          const el = e.target as HTMLElement
          const to = parseFloat(el.dataset.count || '0')
          const dec = parseInt(el.dataset.decimals || '0', 10)
          if (reduce) {
            el.textContent = to.toFixed(dec)
            return
          }
          const start = performance.now()
          const dur = 1600
          const tick = (now: number) => {
            const p = Math.min((now - start) / dur, 1)
            const eased = 1 - Math.pow(1 - p, 4)
            el.textContent = (to * eased).toFixed(dec)
            if (p < 1) requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
      },
      { threshold: 0.6 },
    )
    document.querySelectorAll('[data-count]').forEach((el) => counters.observe(el))

    const onMove = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.spot') as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    document.addEventListener('pointermove', onMove, { passive: true })

    const progress = Array.from(document.querySelectorAll<HTMLElement>('[data-progress]'))
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const vh = window.innerHeight
        progress.forEach((el) => {
          const r = el.getBoundingClientRect()
          const p = Math.min(Math.max((vh * 0.8 - r.top) / (r.height + vh * 0.3), 0), 1)
          el.style.setProperty('--p', p.toFixed(3))
        })
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    return () => {
      reveal.disconnect()
      counters.disconnect()
      document.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return null
}
