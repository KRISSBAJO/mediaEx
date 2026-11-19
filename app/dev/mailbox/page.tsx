import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const metadata: Metadata = { title: 'Dev mailbox — MediaEX', robots: { index: false } }
export const dynamic = 'force-dynamic'

type Mail = { to: string; subject: string; text: string; link?: string; at: string }

/** Development only: shows the emails MediaEX would have sent (verification, password reset, invitations). */
export default async function DevMailbox() {
  if (process.env.NODE_ENV === 'production') notFound()
  const raw = await readFile(path.join(process.cwd(), '.mailbox', 'mail.jsonl'), 'utf8').catch(() => '')
  const mails = raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Mail)
    .reverse()
    .slice(0, 50)

  return (
    <main className="devmail">
      <header>
        <p className="mono-label">Development only · not available in production</p>
        <h1>Dev mailbox</h1>
        <p>
          Without <code>RESEND_API_KEY</code>, MediaEX writes outgoing emails here instead of sending them. Newest first. Reload to see new mail.
        </p>
      </header>
      {mails.length === 0 ? (
        <p className="devmail-empty">No emails yet. Sign up, reset a password or invite someone.</p>
      ) : (
        <ul>
          {mails.map((m, i) => (
            <li key={i}>
              <div className="devmail-top">
                <b>{m.subject}</b>
                <time>{new Date(m.at).toLocaleString('en-GB')}</time>
              </div>
              <p className="devmail-to">To {m.to}</p>
              <pre>{m.text}</pre>
              {m.link && (
                <a className="btn btn-primary btn-sm" href={m.link}>
                  Open the link
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
