import Link from 'next/link'
import HeroScene from '@/components/HeroScene'
import Logo from '@/components/Logo'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-main">
        <Link href="/" className="brand auth-brand" aria-label="MediaEX home">
          <Logo size={22} />
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
          <p className="auth-side-kicker">The media cloud</p>
          <p className="auth-side-title">Every frame. Every format. Everywhere.</p>
          <ul>
            <li>
              <b>3</b> codecs per video
            </li>
            <li>
              <b>50 GB</b> resumable uploads
            </li>
            <li>
              <b>100 GB</b> free to start
            </li>
          </ul>
        </div>
      </aside>
    </div>
  )
}
