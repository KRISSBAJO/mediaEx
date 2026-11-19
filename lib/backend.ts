// Server-side transport for the standalone MediaEX API. BACKEND_URL is supplied by the operator.
export async function backendFetch(path: string, init: RequestInit & { duplex?: 'half' } = {}) {
  const configured = process.env.BACKEND_URL ?? (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:3401')
  if (!configured) throw new Error('BACKEND_URL is required.')
  const base = new URL(configured)
  const url = new URL(path, base)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' ||
      base.search || base.hash || url.origin !== base.origin || !url.pathname.startsWith('/api/')) {
    throw new Error('Invalid MediaEX API destination.')
  }
  const headers = new Headers(init.headers)
  const token = process.env.MEDIAEX_API_TOKEN
  if (process.env.NODE_ENV === 'production' && (!token || token.length < 32)) throw new Error('MEDIAEX_API_TOKEN is required.')
  headers.delete('x-mediaex-service-token')
  if (token) headers.set('x-mediaex-service-token', token)
  return fetch(url, { ...init, headers, cache: 'no-store', redirect: 'manual' })
}

/** Only forward cookies belonging to this app's Better Auth installation. */
export function authCookies(headers: Headers) {
  return (headers.get('cookie') ?? '').split(';').map(value => value.trim())
    .filter(value => /^(?:__Secure-|__Host-)?better-auth\.[^=;]+=/.test(value)).join('; ')
}

export async function proxyAuth(request: Request) {
  const incoming = new URL(request.url)
  if (!incoming.pathname.startsWith('/api/auth/')) return new Response(null, { status: 404 })

  // Preserve browser-origin evidence for Better Auth's CSRF checks. Host and forwarding
  // headers come from the backend connection, never from the browser.
  const headers = new Headers()
  for (const name of [
    'accept', 'accept-language', 'authorization', 'content-type', 'origin', 'referer', 'user-agent',
    'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
  ]) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  const cookie = authCookies(request.headers)
  if (cookie) headers.set('cookie', cookie)

  try {
    const response = await backendFetch(incoming.pathname + incoming.search, {
      method: request.method, headers, body: request.body, duplex: 'half', signal: request.signal,
    })
    // fetch decompresses the upstream body. Forward the browser-facing headers and
    // append each Set-Cookie separately (OAuth and session cookies can arrive together).
    const outgoing = new Headers({ 'cache-control': 'private, no-store' })
    for (const name of ['content-type', 'location', 'retry-after', 'www-authenticate']) {
      const value = response.headers.get(name)
      if (value !== null) outgoing.set(name, value)
    }
    for (const value of response.headers.getSetCookie()) outgoing.append('set-cookie', value)
    return new Response(response.body, { status: response.status, headers: outgoing })
  } catch {
    return Response.json({ code: 'BACKEND_UNAVAILABLE', message: 'MediaEX authentication is temporarily unavailable.' }, {
      status: 503, headers: { 'cache-control': 'private, no-store' },
    })
  }
}
