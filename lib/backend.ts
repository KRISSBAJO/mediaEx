function safeApiPath(path: string) {
  if (path.includes('//')) return false
  try {
    return path.split('/').every((part) => {
      if (!part) return true
      const segment = decodeURIComponent(part)
      return segment !== '.' && segment !== '..' && /^[\p{L}\p{N}._~-]+$/u.test(segment)
    })
  } catch {
    return false
  }
}

// Allow an operator-configured gateway prefix. Validate the raw paths before URL normalizes dot segments.
export async function backendFetch(path: string, init: RequestInit & { duplex?: 'half' } = {}) {
  const configured = process.env.BACKEND_URL ?? (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:3401')
  if (!configured) throw new Error('BACKEND_URL is required.')
  const base = /^(https?:\/\/[^\s/@?#\\%]+)(\/[^?#]*)?$/i.exec(configured)
  const prefix = (base?.[2] ?? '').replace(/\/$/, '')
  const pathname = path.split('?', 1)[0]
  if (!base || !safeApiPath(base[2] ?? '') || !pathname.startsWith('/api/') ||
      !safeApiPath(pathname) || path.includes('#')) {
    throw new Error('Invalid MediaEX API destination.')
  }
  const url = new URL(prefix + path, base[1])
  const headers = new Headers(init.headers)
  const token = process.env.MEDIAEX_API_TOKEN
  if (process.env.NODE_ENV === 'production' && (!token || token.length < 32)) throw new Error('MEDIAEX_API_TOKEN is required.')
  headers.delete('x-mediaex-service-token')
  if (token) headers.set('x-mediaex-service-token', token)
  headers.delete('x-mediaex-auth-cookie')
  if (prefix) {
    const cookie = authCookies(headers)
    headers.delete('cookie')
    if (cookie) headers.set('x-mediaex-auth-cookie', cookie)
  }
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

/**
 * Forwards the media API (/api/assets, uploads, media, folders, collections, tags, searches, keys, webhooks, v1) to the backend, streaming both ways so large uploads
 * and video segments never sit in memory. Redirects (presigned bucket URLs) pass through to the browser.
 */
export async function proxyMedia(request: Request) {
  const incoming = new URL(request.url)
  if (!/^\/api\/(assets|uploads|media|folders|collections|tags|searches|fields|moderation|keys|webhooks|v1|playback|analytics|encoding|billing|admin)(\/|$)/.test(incoming.pathname)) return new Response(null, { status: 404 })

  const headers = new Headers()
  // country headers some CDNs add feed view analytics; payment providers sign their webhooks
  for (const name of ['accept', 'content-type', 'content-length', 'range', 'if-none-match', 'if-modified-since', 'origin', 'referer', 'user-agent', 'cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'stripe-signature', 'x-paystack-signature']) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  // the public API (/api/v1) authenticates with an API key and never with the browser's session
  const publicApi = /^\/api\/v1(\/|$)/.test(incoming.pathname)
  if (publicApi) {
    const authorization = request.headers.get('authorization')
    if (authorization !== null) headers.set('authorization', authorization)
  } else {
    const cookie = authCookies(request.headers)
    if (cookie) headers.set('cookie', cookie)
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'

  try {
    const response = await backendFetch(incoming.pathname + incoming.search, {
      method: request.method, headers, body: hasBody ? request.body : undefined, duplex: hasBody ? 'half' : undefined, signal: request.signal,
    })
    const outgoing = new Headers()
    for (const name of [
      'content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'content-disposition',
      'location', 'etag', 'last-modified', 'access-control-allow-origin', 'retry-after',
    ]) {
      const value = response.headers.get(name)
      if (value !== null) outgoing.set(name, value)
    }
    if (!outgoing.has('cache-control')) outgoing.set('cache-control', 'private, no-store')
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: outgoing })
  } catch {
    return Response.json({ error: 'MediaEX media is temporarily unavailable. Try again in a moment.' }, {
      status: 503, headers: { 'cache-control': 'private, no-store' },
    })
  }
}
