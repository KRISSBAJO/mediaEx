'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import Logo from './Logo'

const LINKS = [
  { id: 'features', label: 'Product' },
  { id: 'engine', label: 'Engine' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'developers', label: 'Developers' },
  { id: 'pricing', label: 'Pricing', page: '/pricing' },
]

/** on the landing page the links scroll to sections; elsewhere they go back to them. Pricing has its own page. */
const hrefFor = (l: (typeof LINKS)[number], home: boolean) => ('page' in l && l.page ? l.page : `${home ? '' : '/'}#${l.id}`)

export default function Nav() {
  const { data: session } = authClient.useSession()
  const path = usePathname()
  const home = path === '/'
  const onPage = LINKS.find((l) => 'page' in l && l.page === path)?.id ?? null
  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [bar, setBar] = useState({ x: 0, w: 0 })
  const headerRef = useRef<HTMLElement>(null)
  const linksRef = useRef<HTMLElement>(null)
  // keep the bar visible while the page jumps to a section (on load with a hash, or after clicking a link)
  const pinned = useRef(true)
  const pinTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // unpin once scrolling has been quiet for a moment
  const settle = () => {
    clearTimeout(pinTimer.current)
    pinTimer.current = setTimeout(() => (pinned.current = false), 250)
  }
  const pin = () => {
    pinned.current = true
    setHidden(false)
    // if the page never moves (link to the section already on screen), unpin anyway
    clearTimeout(pinTimer.current)
    pinTimer.current = setTimeout(() => (pinned.current = false), 2500)
  }

  // solid background once scrolled, hide while scrolling down, show on the way up, page progress line
  useEffect(() => {
    let last = window.scrollY
    let ticking = false
    pinTimer.current = setTimeout(() => (pinned.current = false), 2500)
    const update = () => {
      ticking = false
      const y = window.scrollY
      const max = document.documentElement.scrollHeight - window.innerHeight
      headerRef.current?.style.setProperty('--progress', max > 0 ? (y / max).toFixed(4) : '0')
      setScrolled(y > 24)
      if (pinned.current) {
        settle()
        last = y
      } else if (Math.abs(y - last) > 6) {
        setHidden(y > last && y > 640)
        last = y
      }
    }
    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(update)
      }
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      clearTimeout(pinTimer.current)
    }
  }, [])

  // which section is in the middle of the screen
  useEffect(() => {
    if (!home) return setActive(onPage)
    const sections = LINKS.map((l) => document.getElementById(l.id)).filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id)
        })
      },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    sections.forEach((s) => io.observe(s))
    const onTop = () => {
      if (window.scrollY < window.innerHeight * 0.5) setActive(null)
    }
    window.addEventListener('scroll', onTop, { passive: true })
    return () => {
      io.disconnect()
      window.removeEventListener('scroll', onTop)
    }
  }, [home, onPage])

  // slide the underline to the active link
  useEffect(() => {
    const place = () => {
      const el = active ? linksRef.current?.querySelector<HTMLElement>(`[data-id="${active}"]`) : null
      setBar(el ? { x: el.offsetLeft, w: el.offsetWidth } : { x: 0, w: 0 })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [active])

  // full-screen menu on phones: lock scroll, close on Escape or when widening the window
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const mq = window.matchMedia('(min-width: 861px)')
    const onWide = () => mq.matches && setOpen(false)
    window.addEventListener('keydown', onKey)
    mq.addEventListener('change', onWide)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      mq.removeEventListener('change', onWide)
    }
  }, [open])

  const cls = ['nav', scrolled && 'is-scrolled', hidden && !open && 'is-hidden', open && 'is-open'].filter(Boolean).join(' ')

  return (
    <header ref={headerRef} className={cls}>
      <div className="nav-inner">
        <a href={home ? '#top' : '/'} className="brand" aria-label="MediaEX home" onClick={() => setOpen(false)}>
          <Logo size={22} />
        </a>

        <nav ref={linksRef} className="nav-links" aria-label="Main">
          {LINKS.map((l, i) => (
            <a key={l.id} href={hrefFor(l, home)} data-id={l.id} onClick={pin} className={active === l.id ? 'is-active' : ''} aria-current={active === l.id ? 'true' : undefined}>
              <b>0{i + 1}</b>
              {l.label}
            </a>
          ))}
          <span className="nav-underline" style={{ transform: `translateX(${bar.x}px)`, width: bar.w, opacity: bar.w ? 1 : 0 }} aria-hidden="true" />
        </nav>

        <div className="nav-cta">
          {session ? (
            <Link href="/dashboard" className="btn btn-primary btn-sm">
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="nav-signin">
                Sign in
              </Link>
              <Link href="/sign-up" className="btn btn-primary btn-sm">
                Start free
              </Link>
            </>
          )}
          <button
            type="button"
            className="nav-burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="nav-sheet"
            onClick={() => setOpen((o) => !o)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
      <span className="nav-progress" aria-hidden="true" />

      <div id="nav-sheet" className="nav-sheet" aria-hidden={!open}>
        <nav aria-label="Mobile">
          {LINKS.map((l, i) => (
            <a key={l.id} href={hrefFor(l, home)} tabIndex={open ? 0 : -1}
              onClick={() => {
                setOpen(false)
                pin()
              }}
              style={{ ['--i' as string]: i }}>
              <b>0{i + 1}</b>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="nav-sheet-foot" style={{ ['--i' as string]: LINKS.length }}>
          {session ? (
            <Link href="/dashboard" className="btn btn-primary btn-lg" tabIndex={open ? 0 : -1} style={{ gridColumn: '1 / -1' }}>
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="btn btn-ghost btn-lg" tabIndex={open ? 0 : -1}>
                Sign in
              </Link>
              <Link href="/sign-up" className="btn btn-primary btn-lg" tabIndex={open ? 0 : -1}>
                Start free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
