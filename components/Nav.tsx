'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Logo from './Logo'

const LINKS = [
  { href: '#features', label: 'Product' },
  { href: '#engine', label: 'Engine' },
  { href: '#developers', label: 'Developers' },
  { href: '#pricing', label: 'Pricing' },
]

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`nav ${scrolled ? 'is-scrolled' : ''} ${open ? 'is-open' : ''}`}>
      <div className="nav-inner">
        <a href="#top" className="brand" aria-label="MediaEX home">
          <Logo />
          <span>
            Media<b>EX</b>
          </span>
        </a>
        <nav className="nav-links" aria-label="Main">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="nav-cta">
          <Link href="/sign-in" className="nav-signin">
            Sign in
          </Link>
          <Link href="/sign-up" className="btn btn-primary btn-sm">
            Start free
          </Link>
          <button
            className="nav-burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  )
}
