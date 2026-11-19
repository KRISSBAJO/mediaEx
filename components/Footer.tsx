'use client'

import { useEffect, useState } from 'react'
import Logo from './Logo'

const COLUMNS = [
  { h: 'Product', l: [['Upload'], ['Transcoding'], ['Streaming'], ['AI Studio', 'New'], ['Analytics'], ['Pricing']] },
  { h: 'Developers', l: [['Docs'], ['API reference'], ['SDKs'], ['Player'], ['Changelog'], ['Status']] },
  { h: 'Company', l: [['About'], ['Customers'], ['Careers', 'Hiring'], ['Blog'], ['Press'], ['Contact']] },
  { h: 'Legal', l: [['Terms'], ['Privacy'], ['Security'], ['DPA'], ['Cookies']] },
]

const CITIES = [
  { c: 'Lagos', tz: 'Africa/Lagos' },
  { c: 'Paris', tz: 'Europe/Paris' },
  { c: 'New York', tz: 'America/New_York' },
]

const SOCIAL = [
  { n: 'X', d: 'M4 4l16 16M20 4 4 20' },
  { n: 'YouTube', d: 'M3 8.2c0-1.6 1.2-2.9 2.8-3C8 5 10 5 12 5s4 0 6.2.2c1.6.1 2.8 1.4 2.8 3v7.6c0 1.6-1.2 2.9-2.8 3-2.2.2-4.2.2-6.2.2s-4 0-6.2-.2c-1.6-.1-2.8-1.4-2.8-3V8.2Zm7 1v5.6l4.8-2.8L10 9.2Z' },
  { n: 'GitHub', d: 'M9 19c-4 1.3-4-2-6-2.5m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.8 2.3 5.8 2.6 5.8 2.6a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.4 9c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2v3.5' },
  { n: 'LinkedIn', d: 'M7 10v7M7 7v.01M11 17v-4a2 2 0 0 1 4 0v4m-4-7v7M4 4h16v16H4z' },
]

function Clocks() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(id)
  }, [])
  return (
    <ul className="footer-clocks" aria-label="Edge regions">
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

function Newsletter() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'error' | 'sending' | 'done'>('idle')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setState('error')
    setState('sending')
    await new Promise((r) => setTimeout(r, 700)) // TODO: call the real newsletter endpoint
    setState('done')
  }

  return (
    <form className="footer-news" onSubmit={submit} noValidate>
      <label htmlFor="footer-email">Release notes, once a month</label>
      {state === 'done' ? (
        <p className="footer-news-done">
          <i /> You&apos;re on the list. See you next release.
        </p>
      ) : (
        <div className={`footer-news-row ${state === 'error' ? 'has-error' : ''}`}>
          <input
            id="footer-email"
            type="email"
            autoComplete="email"
            placeholder="you@studio.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (state === 'error') setState('idle')
            }}
            aria-invalid={state === 'error'}
          />
          <button type="submit" disabled={state === 'sending'}>
            {state === 'sending' ? 'Joining…' : 'Subscribe'}
          </button>
        </div>
      )}
      {state === 'error' && <span className="footer-news-error">Enter a valid email address.</span>}
    </form>
  )
}

export default function Footer() {
  return (
    <footer className="footer" id="footer">
      <div className="footer-top">
        <div className="footer-brand">
          <a href="#top" className="brand">
            <Logo />
            <span>
              Media<b>EX</b>
            </span>
          </a>
          <p>The media cloud for creators and studios. Upload once, stream everywhere.</p>
          <a href="#top" className="footer-status">
            <i />
            All systems operational
            <span>p50 38 ms</span>
          </a>
        </div>
        <Newsletter />
      </div>

      <nav className="footer-links" aria-label="Footer">
        {COLUMNS.map((c, i) => (
          <div key={c.h} className="footer-col">
            <h4>
              <b>0{i + 1}</b> {c.h}
            </h4>
            {c.l.map(([x, tag]) => (
              <a key={x} href="#top">
                {x}
                {tag && <em>{tag}</em>}
              </a>
            ))}
          </div>
        ))}
      </nav>

      <div className="footer-mark" aria-hidden="true">
        <span>MediaEX</span>
        <i />
      </div>

      <div className="footer-base">
        <span>© {new Date().getFullYear()} MediaEX, Inc.</span>
        <Clocks />
        <div className="footer-social">
          {SOCIAL.map((s) => (
            <a key={s.n} href="#top" aria-label={s.n}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={s.d} />
              </svg>
            </a>
          ))}
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
