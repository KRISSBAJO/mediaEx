import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { auth } from './auth'

/** The current session, or null. Cached per request. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }))

/** The current session; sends the visitor to sign in (and back here afterwards) when there isn't one. */
export async function requireSession(next = '/dashboard') {
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(next)}`)
  return session
}
