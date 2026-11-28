/**
 * Webhooks: signed HTTP callbacks when things happen to assets.
 *
 *   GET    /api/webhooks                         endpoints with delivery stats          any member
 *   POST   /api/webhooks                         { url, description?, events } → { endpoint, secret }   owners/admins
 *   PATCH  /api/webhooks/:id                     { url?, description?, events?, enabled? }              owners/admins
 *   DELETE /api/webhooks/:id                                                                            owners/admins
 *   GET    /api/webhooks/:id/secret              the signing secret                                     owners/admins
 *   POST   /api/webhooks/:id/rotate              new signing secret                                     owners/admins
 *   POST   /api/webhooks/:id/test                send a webhook.test event                              owners/admins
 *   GET    /api/webhooks/deliveries?endpoint=    the delivery log (newest 100)          any member
 *   GET    /api/webhooks/deliveries/:id          one delivery with its payload and the response
 *   POST   /api/webhooks/deliveries/:id/retry    send it again now                                      owners/admins
 *
 * Each delivery is a POST with a JSON body { id, type, created, workspace, data } and the headers
 *   MediaEX-Event, MediaEX-Delivery, MediaEX-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 * Receivers should recompute the HMAC with their endpoint's secret and reject old timestamps (replays).
 * A 2xx answer within 10 s counts as delivered; anything else is retried with backoff for about a day.
 * Deliveries live in Postgres (claimed with skip locked), so retries survive restarts and several API instances share them.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { pool } from '../auth.mts'
import { HttpError, apiAsset, getAssetRow, requireMember, type AssetRow } from './assets.mts'
import { WEBHOOK_EVENTS, type WebhookDelivery, type WebhookEndpoint, type WebhookEvent } from './types.mts'

const RETRY_AFTER = [30, 120, 600, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600] // seconds; then give up (≈ 24 h in total)
const TIMEOUT_MS = 10_000
const MAX_ENDPOINTS = 20
const prod = process.env.NODE_ENV === 'production'

const rid = (p: string) => `${p}_${randomBytes(12).toString('base64url').replace(/[-_]/g, '').slice(0, 16).toLowerCase()}`
const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`

/* ------------------------------------------------ where we may send (no requests into private networks) */
function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
    return mapped ? privateAddress(mapped[1]) : false
  }
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

/** Checks a URL is acceptable: https (http only to localhost while developing), and never a private address in production. */
export async function checkUrl(raw: string, resolve = true) {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new HttpError(400, 'That isn’t a valid URL.')
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local && !prod)) throw new HttpError(400, 'Webhook URLs must use https.')
  if (u.username || u.password) throw new HttpError(400, 'Put credentials in your receiver, not in the URL.')
  if (raw.length > 500) throw new HttpError(400, 'That URL is too long.')
  if (prod && resolve) {
    const host = u.hostname.replace(/^\[|\]$/g, '')
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [])
    if (!addrs.length) throw new HttpError(400, `Couldn’t find ${u.hostname}.`)
    if (addrs.some((a) => privateAddress(a.address))) throw new HttpError(400, 'Webhooks can’t be sent to private or internal addresses.')
  }
  return u.toString()
}

function cleanEvents(v: unknown): WebhookEvent[] {
  const events = Array.isArray(v) ? [...new Set(v.filter((e): e is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(e as string)))] : []
  if (!events.length) throw new HttpError(400, `Pick at least one event: ${WEBHOOK_EVENTS.join(', ')}.`)
  return events
}

/* ------------------------------------------------ sending events */
type Data = Record<string, unknown>

/** Queues an event for every enabled endpoint in the workspace that subscribed to it. */
export async function emit(orgId: string, type: WebhookEvent, data: Data, db: Pick<typeof pool,'query'> = pool) {
  const { rows } = await db.query<{ id: string }>(`select id from "webhook_endpoint" where "organizationId" = $1 and enabled and $2 = any(events)`, [orgId, type])
  if (!rows.length) return
  const eventId = rid('evt')
  const payload = { id: eventId, type, created: new Date().toISOString(), workspace: orgId, data }
  for (const r of rows) {
    await db.query(`insert into "webhook_delivery" (id, "endpointId", "organizationId", event, payload) values ($1, $2, $3, $4, $5)`, [rid('dlv'), r.id, orgId, type, JSON.stringify(payload)])
  }
  kickDispatcher()
}

/** Queues an asset event. Takes the row (e.g. just before a delete) or an id. Never throws: a webhook problem must not break the action. */
export async function emitAsset(asset: AssetRow | string, type: WebhookEvent) {
  try {
    const row = typeof asset === 'string' ? await getAssetRow(asset) : asset
    if (row) await emit(row.organizationId, type, { asset: apiAsset(row) })
  } catch (e) {
    console.error(`[webhooks] couldn’t queue ${type}:`, e instanceof Error ? e.message : e)
  }
}

export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`
}

/** fetch() reports every network failure as "fetch failed"; the cause says what actually went wrong. */
function networkError(e: Error) {
  const cause = (e as Error & { cause?: { code?: string } }).cause
  const code = cause?.code ?? ''
  const known: Record<string, string> = {
    ENOTFOUND: 'The host name doesn’t resolve',
    EAI_AGAIN: 'DNS lookup failed; will retry',
    ECONNREFUSED: 'Connection refused',
    ECONNRESET: 'The connection was reset',
    ETIMEDOUT: 'The connection timed out',
    EHOSTUNREACH: 'The host is unreachable',
    ENETUNREACH: 'The network is unreachable',
    CERT_HAS_EXPIRED: 'Its TLS certificate has expired',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Its TLS certificate is self-signed',
    SELF_SIGNED_CERT_IN_CHAIN: 'Its TLS certificate chain is self-signed',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Its TLS certificate can’t be verified',
    ERR_TLS_CERT_ALTNAME_INVALID: 'Its TLS certificate doesn’t match the host name',
  }
  if (Object.hasOwn(known, code)) return `${known[code]} (${code})`
  return 'Could not reach the webhook endpoint.'
}

async function deliver(d: { id: string; endpointId: string; payload: unknown; attempts: number; url: string; secret: string; event: string }) {
  const body = JSON.stringify(d.payload)
  const t0 = Date.now()
  let status: number | null = null
  let responseBody: string | null = null
  let error: string | null = null
  try {
    await checkUrl(d.url) // DNS can change after an endpoint was saved
    const res = await fetch(d.url, {
      method: 'POST',
      redirect: 'manual', // a redirect could point anywhere; treat it as a failure
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MediaEX-Webhooks/1.0',
        'MediaEX-Event': d.event,
        'MediaEX-Delivery': d.id,
        'MediaEX-Signature': sign(d.secret, body),
      },
      body,
    })
    status = res.status
    responseBody = (await res.text().catch(() => '')).slice(0, 1000)
  } catch (e) {
    error = e instanceof HttpError ? e.message : e instanceof Error && e.name === 'TimeoutError' ? `No answer within ${TIMEOUT_MS / 1000} s` : e instanceof Error ? networkError(e) : 'Request failed'
  }
  const ms = Date.now() - t0
  const ok = status !== null && status >= 200 && status < 300
  const attempts = d.attempts + 1
  const giveUp = !ok && attempts > RETRY_AFTER.length
  await pool.query(
    `update "webhook_delivery" set status = $2, attempts = $3, "responseStatus" = $4, "responseBody" = $5, "durationMs" = $6, error = $7,
       "deliveredAt" = case when $2 = 'succeeded' then now() else "deliveredAt" end,
       "nextAttemptAt" = now() + ($8 || ' seconds')::interval
     where id = $1`,
    [d.id, ok ? 'succeeded' : giveUp ? 'failed' : 'pending', attempts, status, responseBody, ms, ok ? null : (error ?? `HTTP ${status}`), String(RETRY_AFTER[attempts - 1] ?? 0)],
  )
  await pool.query(`update "webhook_endpoint" set failures = case when $2 then 0 else failures + 1 end where id = $1`, [d.endpointId, ok])
}

type DispatcherState = { busy: boolean; started: boolean; tick: () => Promise<void> }
declare global {
  var __mxHooks: DispatcherState | undefined
}

/** Delivers due webhooks in the background. Started with the API server. */
export function startDispatcher() {
  if (globalThis.__mxHooks?.started) return globalThis.__mxHooks
  const state: DispatcherState = {
    busy: false,
    started: true,
    tick: async () => {
      if (state.busy) return
      state.busy = true
      try {
        for (;;) {
          const { rows } = await pool.query<{ id: string; endpointId: string; payload: unknown; attempts: number; url: string; secret: string; event: string }>(
            `update "webhook_delivery" d set "nextAttemptAt" = now() + interval '2 minutes'
               from "webhook_endpoint" e
              where e.id = d."endpointId" and d.id in (
                select id from "webhook_delivery" where status = 'pending' and "nextAttemptAt" <= now() order by "nextAttemptAt" for update skip locked limit 10)
              returning d.id, d."endpointId", d.payload, d.attempts, e.url, e.secret, d.event`,
          )
          if (!rows.length) break
          await Promise.all(rows.map(deliver))
        }
      } catch (e) {
        console.error('[webhooks]', e instanceof Error ? e.message : e)
      } finally {
        state.busy = false
      }
    },
  }
  globalThis.__mxHooks = state
  setInterval(() => void state.tick(), 3000).unref()
  void state.tick()
  return state
}
export const kickDispatcher = () => void startDispatcher().tick()

/* ------------------------------------------------ managing endpoints */
async function listEndpoints(orgId: string): Promise<WebhookEndpoint[]> {
  const { rows } = await pool.query<{ id: string; url: string; description: string | null; events: WebhookEvent[]; enabled: boolean; failures: number; createdAt: Date; total: string; succeeded: string; failed: string; pending: string }>(
    `select e.id, e.url, e.description, e.events, e.enabled, e.failures, e."createdAt",
            count(d.id) as total, count(d.id) filter (where d.status = 'succeeded') as succeeded,
            count(d.id) filter (where d.status = 'failed') as failed, count(d.id) filter (where d.status = 'pending') as pending
       from "webhook_endpoint" e left join "webhook_delivery" d on d."endpointId" = e.id and d."createdAt" > now() - interval '7 days'
      where e."organizationId" = $1 group by e.id order by e."createdAt"`,
    [orgId],
  )
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    description: r.description,
    events: r.events,
    enabled: r.enabled,
    failures: r.failures,
    createdAt: new Date(r.createdAt).toISOString(),
    stats: { total: Number(r.total), succeeded: Number(r.succeeded), failed: Number(r.failed), pending: Number(r.pending) },
  }))
}

type DeliveryRow = Omit<WebhookDelivery, 'createdAt' | 'deliveredAt' | 'nextAttemptAt'> & { createdAt: Date; deliveredAt: Date | null; nextAttemptAt: Date }
const deliveryDTO = (r: DeliveryRow): WebhookDelivery => ({
  ...r,
  createdAt: new Date(r.createdAt).toISOString(),
  deliveredAt: r.deliveredAt ? new Date(r.deliveredAt).toISOString() : null,
  nextAttemptAt: r.status === 'pending' ? new Date(r.nextAttemptAt).toISOString() : null,
})
const DELIVERY_COLS = `d.id, d."endpointId", e.url, d.event, d.status, d.attempts, d."responseStatus", d."durationMs", d.error, d."createdAt", d."deliveredAt", d."nextAttemptAt"`

export async function handleWebhooks(req: Request, parts: string[]) {
  const m = await requireMember(req.headers)
  const manage = m.role === 'owner' || m.role === 'admin'
  const mustManage = () => {
    if (!manage) throw new HttpError(403, 'Only owners and admins can change webhooks.')
  }
  const [, , a, b, c] = parts // api, webhooks, a?, b?, c?
  const body = async () => ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>

  // the delivery log
  if (a === 'deliveries') {
    if (!b && req.method === 'GET') {
      const endpoint = new URL(req.url).searchParams.get('endpoint')
      const { rows } = await pool.query<DeliveryRow>(
        `select ${DELIVERY_COLS} from "webhook_delivery" d join "webhook_endpoint" e on e.id = d."endpointId"
          where d."organizationId" = $1 and ($2::text is null or d."endpointId" = $2) order by d."createdAt" desc limit 100`,
        [m.orgId, endpoint],
      )
      return Response.json({ deliveries: rows.map(deliveryDTO) }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (b && !c && req.method === 'GET') {
      const { rows } = await pool.query<DeliveryRow & { payload: unknown; responseBody: string | null }>(
        `select ${DELIVERY_COLS}, d.payload, d."responseBody" from "webhook_delivery" d join "webhook_endpoint" e on e.id = d."endpointId" where d.id = $1 and d."organizationId" = $2`,
        [b, m.orgId],
      )
      if (!rows[0]) throw new HttpError(404, 'That delivery doesn’t exist.')
      return Response.json({ delivery: { ...deliveryDTO(rows[0]), payload: rows[0].payload, responseBody: rows[0].responseBody } })
    }
    if (b && c === 'retry' && req.method === 'POST') {
      mustManage()
      const { rowCount } = await pool.query(`update "webhook_delivery" set status = 'pending', "nextAttemptAt" = now() where id = $1 and "organizationId" = $2`, [b, m.orgId])
      if (!rowCount) throw new HttpError(404, 'That delivery doesn’t exist.')
      kickDispatcher()
      return Response.json({ ok: true })
    }
    throw new HttpError(404, 'Not found')
  }

  if (!a && req.method === 'GET') return Response.json({ endpoints: await listEndpoints(m.orgId) }, { headers: { 'Cache-Control': 'no-store' } })

  if (!a && req.method === 'POST') {
    mustManage()
    const x = await body()
    const url = await checkUrl(typeof x.url === 'string' ? x.url.trim() : '')
    const events = cleanEvents(x.events)
    const { rows } = await pool.query('select count(*)::int as n from "webhook_endpoint" where "organizationId" = $1', [m.orgId])
    if (rows[0].n >= MAX_ENDPOINTS) throw new HttpError(400, `A workspace can have up to ${MAX_ENDPOINTS} endpoints.`)
    const id = rid('whk')
    const secret = newSecret()
    const description = typeof x.description === 'string' ? x.description.trim().slice(0, 120) || null : null
    await pool.query('insert into "webhook_endpoint" (id, "organizationId", url, description, events, secret) values ($1, $2, $3, $4, $5, $6)', [id, m.orgId, url, description, events, secret])
    return Response.json({ endpoint: (await listEndpoints(m.orgId)).find((e) => e.id === id), secret }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  }

  if (!a) throw new HttpError(405, 'Method not allowed')
  const { rows: found } = await pool.query<{ id: string; secret: string }>('select id, secret from "webhook_endpoint" where id = $1 and "organizationId" = $2', [a, m.orgId])
  if (!found[0]) throw new HttpError(404, 'That endpoint doesn’t exist.')

  if (!b && req.method === 'PATCH') {
    mustManage()
    const x = await body()
    if (x.url !== undefined) await pool.query('update "webhook_endpoint" set url = $2 where id = $1', [a, await checkUrl(String(x.url).trim())])
    if (x.events !== undefined) await pool.query('update "webhook_endpoint" set events = $2 where id = $1', [a, cleanEvents(x.events)])
    if (x.description !== undefined) await pool.query('update "webhook_endpoint" set description = $2 where id = $1', [a, typeof x.description === 'string' ? x.description.trim().slice(0, 120) || null : null])
    if (typeof x.enabled === 'boolean') await pool.query('update "webhook_endpoint" set enabled = $2, failures = case when $2 then 0 else failures end where id = $1', [a, x.enabled])
    return Response.json({ endpoints: await listEndpoints(m.orgId) })
  }
  if (!b && req.method === 'DELETE') {
    mustManage()
    await pool.query('delete from "webhook_endpoint" where id = $1', [a])
    return Response.json({ endpoints: await listEndpoints(m.orgId) })
  }
  if (b === 'secret' && req.method === 'GET') {
    mustManage()
    return Response.json({ secret: found[0].secret }, { headers: { 'Cache-Control': 'no-store' } })
  }
  if (b === 'rotate' && req.method === 'POST') {
    mustManage()
    const secret = newSecret()
    await pool.query('update "webhook_endpoint" set secret = $2 where id = $1', [a, secret])
    return Response.json({ secret }, { headers: { 'Cache-Control': 'no-store' } })
  }
  if (b === 'test' && req.method === 'POST') {
    mustManage()
    const payload = { id: rid('evt'), type: 'webhook.test', created: new Date().toISOString(), workspace: m.orgId, data: { message: 'Sent from the MediaEX dashboard to check your endpoint.' } }
    const did = rid('dlv')
    await pool.query(`insert into "webhook_delivery" (id, "endpointId", "organizationId", event, payload) values ($1, $2, $3, 'webhook.test', $4)`, [did, a, m.orgId, JSON.stringify(payload)])
    kickDispatcher()
    return Response.json({ delivery: did })
  }
  throw new HttpError(404, 'Not found')
}
