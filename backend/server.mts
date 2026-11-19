import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { auth, baseURL, enabledSocial, pool } from './auth.mts'
import { getAccount, getInvitation } from './account.mts'
import { handleMedia, isDurable } from './media/routes.mts'
import { storage } from './media/storage.mts'
import { startWorker } from './media/worker.mts'

const frontend = new URL(baseURL)
const serviceToken = process.env.MEDIAEX_API_TOKEN
if (process.env.NODE_ENV === 'production') {
  for (const name of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'MEDIAEX_API_TOKEN']) {
    if (!process.env[name]) throw new Error(`Missing required backend setting ${name}`)
  }
  if (serviceToken!.length < 32) throw new Error('MEDIAEX_API_TOKEN must have at least 32 characters')
  if (frontend.protocol !== 'https:') throw new Error('BETTER_AUTH_URL must use HTTPS in production')
}
const port = Number(process.env.PORT ?? 3401)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid backend PORT')

const digest = (value: string) => createHash('sha256').update(value).digest()
const expectedToken = serviceToken ? digest(serviceToken) : null
const authHandler = toNodeHandler(auth)
const readinessQuery = { text: 'select 1', query_timeout: 3000 }

/** Media handlers are written against web Request/Response; bridge Node's request and response to them. */
function toWebRequest(req: IncomingMessage, pathname: string) {
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(new URL(req.url ?? pathname, frontend), {
    method,
    headers: fromNodeHeaders(req.headers),
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: hasBody ? 'half' : undefined,
  } as RequestInit)
}

async function sendWeb(res: ServerResponse, response: Response) {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, name) => (headers[name] = value))
  res.writeHead(response.status, headers)
  if (!response.body) return void res.end()
  await new Promise<void>((resolve, reject) => {
    const body = Readable.fromWeb(response.body as never)
    body.on('error', reject)
    res.on('close', () => {
      body.destroy()
      resolve()
    })
    body.pipe(res)
  })
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const target = req.url ?? '/'
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return json(res, 400, { error: 'Invalid request path' })
  const { pathname } = new URL(target, frontend)
  const read = req.method === 'GET' || req.method === 'HEAD'
  if (pathname === '/' && read) return json(res, 200, { service: 'MediaEX API', health: '/healthz', readiness: '/readyz' })
  if (pathname === '/healthz' && read) return json(res, 200, { status: 'ok' })
  if (pathname === '/readyz' && read) {
    try {
      await pool.query(readinessQuery)
      return json(res, 200, { status: 'ready' })
    } catch {
      return json(res, 503, { status: 'unavailable' })
    }
  }
  if (!pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' })
  const supplied = req.headers['x-mediaex-service-token']
  if (expectedToken && (typeof supplied !== 'string' || !timingSafeEqual(expectedToken, digest(supplied)))) {
    return json(res, 403, { error: 'Forbidden' })
  }
  for (const header of Object.keys(req.headers)) {
    if (header === 'forwarded' || header.startsWith('x-forwarded-') || header === 'x-real-ip' || header === 'x-mediaex-service-token') delete req.headers[header]
  }
  req.headers.host = frontend.host
  req.headers['x-forwarded-proto'] = frontend.protocol.slice(0, -1)
  res.setHeader('cache-control', 'no-store')
  if (pathname.startsWith('/api/auth/')) return await authHandler(req, res)
  if (/^\/api\/(assets|uploads|media)(\/|$)/.test(pathname)) {
    const response = await handleMedia(toWebRequest(req, pathname), pathname)
    if (response) return await sendWeb(res, response)
  }
  if (!read) return json(res, 405, { error: 'Method not allowed' })
  if (pathname === '/api/mediaex/providers') return json(res, 200, enabledSocial)
  if (pathname === '/api/mediaex/account') {
    const account = await getAccount(fromNodeHeaders(req.headers))
    return account ? json(res, 200, account) : json(res, 401, { error: 'Sign in required' })
  }
  const invitation = /^\/api\/mediaex\/invitations\/([^/]+)$/.exec(pathname)
  if (invitation) {
    let id
    try { id = decodeURIComponent(invitation[1]) } catch { return json(res, 400, { error: 'Invalid invitation ID' }) }
    const record = await getInvitation(id)
    return record ? json(res, 200, record) : json(res, 404, { error: 'Invitation not found' })
  }
  return json(res, 404, { error: 'Not found' })
}

pool.on('error', () => console.error('MediaEX lost an idle database connection'))
const server = createServer((req, res) => {
  void route(req, res).catch(() => {
    console.error('MediaEX backend request failed')
    if (!res.headersSent) json(res, 500, { error: 'Request failed' })
    else res.destroy()
  })
})
server.listen(port, '0.0.0.0', () => {
  console.log(`MediaEX backend listening on port ${port}`)
  const kind = storage().kind
  console.log(`MediaEX media storage: ${kind === 's3' ? 'S3-compatible bucket' : 'local disk'}${isDurable() ? '' : ' (not durable: set S3_* or mount MEDIA_DIR)'}`)
  // the media pipeline worker shares this process; MEDIA_WORKER=off runs an API-only instance
  if (process.env.MEDIA_WORKER !== 'off') startWorker()
})
function shutdown() {
  server.close(() => { void pool.end() })
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
