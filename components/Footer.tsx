'use client'

import { useEffect, useState } from 'react'
import Logo from './Logo'

// only places that exist: sections, pages and the dashboard
const COLUMNS = [
  { h: 'Product', l: [['Platform', '/#features'], ['Take the tour', '/#tour'], ['Engine', '/#engine'], ['Pricing', '/pricing']] },
  { h: 'Developers', l: [['API overview', '/#developers'], ['API keys and webhooks', '/dashboard/developers']] },
  { h: 'Account', l: [['Start free', '/sign-up'], ['Sign in', '/sign-in'], ['Dashboard', '/dashboard']] },
]

const CITIES = [
  { c: 'Lagos', tz: 'Africa/Lagos' },
  { c: 'Paris', tz: 'Europe/Paris' },
  { c: 'New York', tz: 'America/New_York' },
]


function Clocks() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(id)
  }, [])
  return (
    <ul className="footer-clocks" aria-label="Local time">
      {CITIES.map(({ c, tz }) => (
        <li key={c}>
          <span>{c}</span>
          <time suppressHydrationWarning>
            {now ? now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '--:--'}
          </time>
        </li>
      ))}
    </ul>
  )
}

export default function Footer() {
  return (
    <footer className="footer" id="footer">
      {/* one row: who we are and the way in on the left, the three link columns beside it */}
      <div className="footer-main">
        <div className="footer-intro">
          <a href="/" className="brand" aria-label="MediaEX home">
            <Logo size={26} />
          </a>
          <p>The media cloud for creators and studios. Start with 100 GB free, no card needed.</p>
          <div className="footer-intro-row">
            <a href="/sign-up" className="btn btn-primary btn-sm">
              Start free
            </a>
            <a href="/pricing" className="link-arrow">
              See pricing
            </a>
          </div>
        </div>
        <nav className="footer-nav" aria-label="Footer">
          {COLUMNS.map((c, i) => (
            <div key={c.h} className="fcol">
              <h4>
                <b>0{i + 1}</b> {c.h}
              </h4>
              <ul>
                {c.l.map(([x, href]) => (
                  <li key={x}>
                    <a href={href}>{x}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="footer-mark" aria-hidden="true">
        <span>
          media<em>EX</em>
        </span>
        <i />
      </div>

      <div className="footer-base">
        <span>© {new Date().getFullYear()} MediaEX, Inc.</span>
        <Clocks />
        <div className="footer-social">
          <a href="#top" className="footer-up" aria-label="Back to top">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 13V3m-4 4 4-4 4 4" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  )
}
