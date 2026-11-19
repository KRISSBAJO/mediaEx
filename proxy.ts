import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Fast first gate for the dashboard: no session cookie, straight to sign-in.
 * The dashboard layout still validates the session against the database, because a cookie can be stale or forged.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next()
  const url = new URL('/sign-in', request.url)
  url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
