import Nav from './Nav'
import Footer from './Footer'

export type LegalSection = { id: string; title: string; body: React.ReactNode }

/** Where people reach us about their data or these terms; set NEXT_PUBLIC_LEGAL_EMAIL to publish an address. */
export const LEGAL_EMAIL = process.env.NEXT_PUBLIC_LEGAL_EMAIL || null

export function Contact() {
  return LEGAL_EMAIL ? (
    <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>
  ) : (
    <>a reply to any email we’ve sent you, from the address on your account</>
  )
}

/** The Terms and Privacy pages: a readable column, with the sections listed beside it on wide screens. */
export default function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: React.ReactNode; sections: LegalSection[] }) {
  return (
    <>
      <Nav />
      <main id="top" className="legal">
        <header className="legal-head">
          <p className="legal-kicker">Legal</p>
          <h1>{title}</h1>
          <p className="legal-updated">Last updated {updated}</p>
          <div className="legal-intro">{intro}</div>
        </header>
        <div className="legal-body">
          <nav className="legal-toc" aria-label="On this page">
            <p>On this page</p>
            <ol>
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>
                    <b>{String(i + 1).padStart(2, '0')}</b> {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <article className="legal-text">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id}>
                <h2>
                  <b>{String(i + 1).padStart(2, '0')}</b>
                  {s.title}
                </h2>
                {s.body}
              </section>
            ))}
          </article>
        </div>
      </main>
      <Footer />
    </>
  )
}
