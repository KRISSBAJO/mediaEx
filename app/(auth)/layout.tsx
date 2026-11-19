import Link from 'next/link'
import HeroScene from '@/components/HeroScene'
import Logo from '@/components/Logo'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-main">
        <Link href="/" className="brand auth-brand" aria-label="MediaEX home">
          <Logo />
          <span>
            Media<b>EX</b>
          </span>
        </Link>
        <main className="auth-form-wrap">{children}</main>
        <footer className="auth-foot">
          <span>© {new Date().getFullYear()} MediaEX</span>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href="#">Status</a>
        </footer>
      </div>

      <aside className="auth-side" aria-hidden="true">
        <HeroScene mode="panel" />
        <div className="auth-side-copy">
          <p className="auth-side-kicker">MediaEX 2.0</p>
          <p className="auth-side-title">Every frame. Every format. Everywhere.</p>
          <ul>
            <li>
              <b>8K</b> HDR delivery
            </li>
            <li>
              <b>190+</b> edge locations
            </li>
            <li>
              <b>38 ms</b> to first frame
            </li>
          </ul>
        </div>
      </aside>
    </div>
  )
}
