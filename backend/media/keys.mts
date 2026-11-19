/**
 * API keys for the public API (/api/v1). A key is shown once at creation; only its SHA-256 hash is stored.
 *
 *   GET    /api/keys            the workspace's active keys          any member
 *   POST   /api/keys            { name, scope } → { key, secret }    owners and admins
 *   DELETE /api/keys/:id        revoke now                           owners and admins
 *
 * Scopes: read (list and get), upload (read + uploads), full (everything, including edits and deletes).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { pool } from '../auth.mts'
import { HttpError, requireMember } from './assets.mts'
import { KEY_SCOPES, type ApiKey, type KeyScope } from './types.mts'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const PREFIX = 'mx_live_'
const MAX_KEYS = 50
const RATE_PER_MINUTE = Number(process.env.API_RATE_LIMIT_PER_MINUTE || 120)

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

function secret() {
  // 32 characters of base62 ≈ 190 bits; bytes ≥ 248 are skipped so every character is equally likely
  let out = ''
  while (out.length < 32) for (const b of randomBytes(40)) if (b < 248 && out.length < 32) out += ALPHABET[b % 62]
  return PREFIX + out
}

/** Who is calling: a signed-in member (dashboard) or an API key (public API). */
export type Actor = { orgId: string; userId: string | null; role: string; via: 'session' | 'key'; scope: KeyScope; keyName?: string }

export async function sessionActor(headers: Headers): Promise<Actor> {
  const m = await requireMember(headers)
  return { orgId: m.orgId, userId: m.user.id, role: m.role, via: 'session', scope: 'full' }
}

/* ------------------------------------------------ authenticating a key */
const buckets = new Map<string, { tokens: number; at: number }>()
const lastUsedWrite = new Map<string, number>()

/** Reads `Authorization: Bearer mx_live_…`, checks it, and applies the per-key rate limit. */
export async function keyActor(req: Request): Promise<Actor> {
  const auth = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(mx_live_[0-9A-Za-z]{32})$/.exec(auth.trim())
  if (!m) throw new HttpError(401, 'Send your API key as “Authorization: Bearer mx_live_…”. Create keys under Developers in the dashboard.')
  const hash = sha256(m[1])
  const { rows } = await pool.query<{ id: string; organizationId: string; name: string; scope: KeyScope; hash: string; revokedAt: Date | null }>(
    'select id, "organizationId", name, scope, hash, "revokedAt" from "api_key" where hash = $1',
    [hash],
  )
  const k = rows[0]
  // the lookup is by hash; compare again in constant time anyway
  if (!k || k.revokedAt || !timingSafeEqual(Buffer.from(k.hash), Buffer.from(hash))) throw new HttpError(401, 'That API key is invalid or has been revoked.')

  // token bucket: RATE_PER_MINUTE per key, refilled continuously
  const now = Date.now()
  const b = buckets.get(k.id) ?? { tokens: RATE_PER_MINUTE, at: now }
  b.tokens = Math.min(RATE_PER_MINUTE, b.tokens + ((now - b.at) / 60_000) * RATE_PER_MINUTE)
  b.at = now
  if (b.tokens < 1) {
    const wait = Math.ceil(((1 - b.tokens) / RATE_PER_MINUTE) * 60)
    throw Object.assign(new HttpError(429, `Too many requests. This key allows ${RATE_PER_MINUTE} a minute; try again in ${wait} s.`), { retryAfter: wait })
  }
  b.tokens -= 1
  buckets.set(k.id, b)

  // note when it was last used, at most once a minute
  if (now - (lastUsedWrite.get(k.id) ?? 0) > 60_000) {
    lastUsedWrite.set(k.id, now)
    void pool.query('update "api_key" set "lastUsedAt" = now() where id = $1', [k.id])
  }
  return { orgId: k.organizationId, userId: null, role: 'member', via: 'key', scope: k.scope, keyName: k.name }
}

export function requireScope(actor: Actor, need: 'read' | 'upload' | 'full') {
  const rank = { read: 0, upload: 1, full: 2 }
  if (rank[actor.scope] < rank[need]) throw new HttpError(403, `This key’s scope is “${actor.scope}”; this request needs “${need}”.`)
}

/* ------------------------------------------------ managing keys */
async function list(orgId: string): Promise<ApiKey[]> {
  const { rows } = await pool.query<{ id: string; name: string; scope: KeyScope; last4: string; createdAt: Date; lastUsedAt: Date | null; createdBy: string | null }>(
    `select k.id, k.name, k.scope, k.last4, k."createdAt", k."lastUsedAt", u.name as "createdBy"
       from "api_key" k left join "user" u on u.id = k."createdBy"
      where k."organizationId" = $1 and k."revokedAt" is null order by k."createdAt" desc`,
    [orgId],
  )
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString(), lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null }))
}

export async function handleKeys(req: Request, id?: string) {
  const m = await requireMember(req.headers)
  if (!id && req.method === 'GET') return Response.json({ keys: await list(m.orgId) }, { headers: { 'Cache-Control': 'no-store' } })
  if (m.role !== 'owner' && m.role !== 'admin') throw new HttpError(403, 'Only owners and admins can create or revoke API keys.')

  if (!id && req.method === 'POST') {
    const b = ((await req.json().catch(() => null)) ?? {}) as { name?: unknown; scope?: unknown }
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(name)) throw new HttpError(400, 'Name keys with 2–40 lowercase letters, numbers or dashes, e.g. production-web.')
    const scope = (b.scope ?? 'full') as KeyScope
    if (!KEY_SCOPES.includes(scope)) throw new HttpError(400, `scope must be one of: ${KEY_SCOPES.join(', ')}.`)
    const keys = await list(m.orgId)
    if (keys.length >= MAX_KEYS) throw new HttpError(400, `A workspace can have up to ${MAX_KEYS} active keys.`)
    if (keys.some((k) => k.name === name)) throw new HttpError(409, `There’s already a key called ${name}.`)
    const value = secret()
    const kid = `key_${randomBytes(9).toString('base64url').replace(/[-_]/g, '').slice(0, 12).toLowerCase()}`
    await pool.query('insert into "api_key" (id, "organizationId", name, scope, hash, last4, "createdBy") values ($1, $2, $3, $4, $5, $6, $7)', [
      kid,
      m.orgId,
      name,
      scope,
      sha256(value),
      value.slice(-4),
      m.user.id,
    ])
    // the only time the full key is ever returned
    return Response.json({ key: (await list(m.orgId)).find((k) => k.id === kid), secret: value }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  }

  if (id && req.method === 'DELETE') {
    if (!/^key_[a-z0-9]{4,24}$/.test(id)) throw new HttpError(404, 'That key doesn’t exist.')
    const { rowCount } = await pool.query('update "api_key" set "revokedAt" = now() where id = $1 and "organizationId" = $2 and "revokedAt" is null', [id, m.orgId])
    if (!rowCount) throw new HttpError(404, 'That key doesn’t exist.')
    return Response.json({ keys: await list(m.orgId) })
  }
  throw new HttpError(405, 'Method not allowed')
}
