/** Only allow same-site paths as a post-login destination, so ?next= can't send people to another site. */
export function safeNext(next: string | null | undefined, fallback = '/dashboard') {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback
}
