import type { Metadata } from 'next'
import Link from 'next/link'
import AcceptInvite from '@/components/auth/AcceptInvite'
import { pool } from '@/lib/auth'
import { getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Join a workspace — MediaEX' }

type Row = { id: string; email: string; role: string; status: string; expiresAt: Date; org: string; inviter: string }

export default async function AcceptInvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { rows } = await pool
    .query<Row>(
      `select i.id, i.email, i.role, i.status, i."expiresAt", o.name as org, u.name as inviter
         from "invitation" i
         join "organization" o on o.id = i."organizationId"
         join "user" u on u.id = i."inviterId"
        where i.id = $1`,
      [id],
    )
    .catch(() => ({ rows: [] as Row[] }))
  const inv = rows[0]
  const session = await getSession()
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
