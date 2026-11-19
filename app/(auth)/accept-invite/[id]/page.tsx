import type { Metadata } from 'next'
import Link from 'next/link'
import AcceptInvite from '@/components/auth/AcceptInvite'
import { backendFetch } from '@/lib/backend'
import { getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Join a workspace — MediaEX' }

type Row = { id: string; email: string; role: string; status: string; expiresAt: string; org: string; inviter: string }

export default async function AcceptInvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [response, session] = await Promise.all([
    backendFetch(`/api/mediaex/invitations/${encodeURIComponent(id)}`),
    getSession(),
  ])
  if (!response.ok && response.status !== 404) throw new Error(`MediaEX API could not load the invitation (HTTP ${response.status}).`)
  const inv: Row | null = response.ok ? await response.json() : null
  const here = `/accept-invite/${id}`

  if (!inv || inv.status !== 'pending' || new Date(inv.expiresAt) < new Date()) {
    return (
      <div className="auth-card">
        <header className="auth-head">
          <h1>This invitation isn’t valid</h1>
          <p>{inv?.status === 'accepted' ? 'It has already been accepted.' : 'It may have expired or been cancelled. Ask whoever invited you to send a new one.'}</p>
        </header>
        <Link href={session ? '/dashboard' : '/sign-in'} className="btn btn-primary btn-block">
          {session ? 'Go to your dashboard' : 'Sign in'}
        </Link>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <header className="auth-head">
        <h1>Join {inv.org}</h1>
        <p>
          {inv.inviter} invited <b>{inv.email}</b> to join {inv.org} as {inv.role === 'admin' ? 'an admin' : 'a member'}.
        </p>
      </header>
      {!session ? (
        <>
          <Link href={`/sign-up?next=${encodeURIComponent(here)}`} className="btn btn-primary btn-block">
            Create an account with {inv.email}
          </Link>
          <p className="auth-switch">
            Already have an account? <Link href={`/sign-in?next=${encodeURIComponent(here)}`}>Sign in</Link>
          </p>
        </>
      ) : session.user.email.toLowerCase() !== inv.email.toLowerCase() ? (
        <div className="form-note error" role="alert">
          You’re signed in as {session.user.email}. Sign out and sign in as {inv.email} to accept.
        </div>
      ) : (
        <AcceptInvite id={inv.id} org={inv.org} />
      )}
    </div>
  )
}
