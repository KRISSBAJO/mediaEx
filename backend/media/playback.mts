/**
 * Signed playback. An asset is either public by link (the default) or "signed": then everything a viewer loads for it
 * (player info, playlists, segments, thumbnails, transformations, captions) needs a playback token, unless the viewer
 * is a member of its workspace.
 *
 * A token is `<expiry unix seconds>.<base64url HMAC-SHA256(workspace secret, "<assetId>:<expiry>")>`, passed as
 * `?token=`. Customers can mint tokens through the API, or sign them on their own servers with the workspace's
 * playback secret (Developers → Playback signing). Rotating the secret ends every token signed with the old one.
 *
 *   POST /api/assets/:id/playback-token        { expiresIn? } → { token, expiresAt, … }   members
 *   GET  /api/playback/secret                  the workspace's signing secret              owners and admins
 *   POST /api/playback/secret/rotate           replace it                                  owners and admins
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { baseURL, pool } from '../auth.mts'
import { HttpError, prefixOf, requireMember, type AssetRow } from './assets.mts'

export type PlaybackPolicy = 'public' | 'signed'
export const PLAYBACK_POLICIES: PlaybackPolicy[] = ['public', 'signed']

const DEFAULT_TTL = 24 * 3600
const MAX_TTL = 30 * 24 * 3600
const TOKEN = /^(\d{10})\.([A-Za-z0-9_-]{43})$/

// secrets change rarely; keep them for a minute so a busy stream doesn't hit the database for every segment
const cache = new Map<string, { secret: string; at: number }>()

/** The workspace's signing secret, created on first use. */
export async function secretFor(orgId: string): Promise<string> {
  const hit = cache.get(orgId)
  if (hit && Date.now() - hit.at < 60_000) return hit.secret
  const fresh = randomBytes(32).toString('base64url')
  const { rows } = await pool.query<{ playbackSecret: string }>(
    `insert into "workspace_setting" ("organizationId", "playbackSecret") values ($1, $2)
     on conflict ("organizationId") do update set "playbackSecret" = coalesce("workspace_setting"."playbackSecret", excluded."playbackSecret")
     returning "playbackSecret"`,
    [orgId, fresh],
  )
  cache.set(orgId, { secret: rows[0].playbackSecret, at: Date.now() })
  return rows[0].playbackSecret
}

const mac = (secret: string, assetId: string, exp: number) => createHmac('sha256', secret).update(`${assetId}:${exp}`).digest('base64url')

export async function signPlayback(orgId: string, assetId: string, ttl = DEFAULT_TTL) {
  const seconds = Math.min(MAX_TTL, Math.max(60, Math.floor(ttl)))
  const exp = Math.floor(Date.now() / 1000) + seconds
  return { token: `${exp}.${mac(await secretFor(orgId), assetId, exp)}`, expiresAt: new Date(exp * 1000).toISOString() }
}

/** Absolute expiry in Unix seconds, only after authenticating the asset-specific grant. */
export async function verifiedPlaybackExpiry(row: Pick<AssetRow, 'id' | 'organizationId'>, token: string | null | undefined) {
  const m = token ? TOKEN.exec(token) : null
  if (!m) return null
  const exp = Number(m[1])
  if (exp <= Date.now() / 1000) return null
  const expected = Buffer.from(mac(await secretFor(row.organizationId), row.id, exp))
  const given = Buffer.from(m[2])
  return expected.length === given.length && timingSafeEqual(expected, given) && exp > Date.now() / 1000 ? exp : null
}

/** The token on a request, if any. */
export const tokenOf = (req: Request) => new URL(req.url).searchParams.get('token')

const withQuery = (uri: string, token: string) => `${uri}${uri.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`

/**
 * Carries a token into a playlist: every relative URI (segments, nested playlists, init segments, caption playlists)
 * gets `?token=`. Absolute URIs (presigned bucket URLs) are already authorised and stay as they are.
 */
export function tokenisePlaylist(text: string, token: string) {
  const relative = (u: string) => !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('/')
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (!t) return line
      if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (all, u: string) => (relative(u) ? `URI="${withQuery(u, token)}"` : all))
      return relative(t) ? withQuery(t, token) : line
    })
    .join('\n')
}

/** Adds the token to an app-relative file URL (for the player info a signed viewer receives). */
export const tokenUrl = (url: string | null, token: string | null) => (url && token ? withQuery(url, token) : url)

/* ------------------------------------------------ routes */
const isAdmin = (role: string) => role === 'owner' || role === 'admin'

export async function handlePlayback(req: Request, parts: string[]) {
  // /api/playback/secret[/rotate]
  const m = await requireMember(req.headers)
  if (!isAdmin(m.role)) throw new HttpError(403, 'Only owners and admins can see the playback signing secret.')
  if (parts[2] === 'secret' && parts.length === 3 && req.method === 'GET') {
    return Response.json({ secret: await secretFor(m.orgId) }, { headers: { 'Cache-Control': 'no-store' } })
  }
  if (parts[2] === 'secret' && parts[3] === 'rotate' && parts.length === 4 && req.method === 'POST') {
    const secret = randomBytes(32).toString('base64url')
    await pool.query(
      `insert into "workspace_setting" ("organizationId", "playbackSecret") values ($1, $2)
       on conflict ("organizationId") do update set "playbackSecret" = excluded."playbackSecret", "updatedAt" = now()`,
      [m.orgId, secret],
    )
    cache.delete(m.orgId)
    return Response.json({ secret }, { headers: { 'Cache-Control': 'no-store' } })
  }
  throw new HttpError(404, 'Not found')
}

/** Token plus the URLs a viewer uses with it. `absolute` for API callers. */
export async function playbackLinks(row: AssetRow, ttl: number | undefined, absolute: boolean) {
  const { token, expiresAt } = await signPlayback(row.organizationId, row.id, ttl ?? DEFAULT_TTL)
  const base = absolute ? baseURL : ''
  const rel = (key: string) => `/api/media/${row.id}/${key.slice(prefixOf(row).length + 1)}`
  return {
    token,
    expiresAt,
    embedUrl: `${baseURL}/embed/${row.id}?token=${encodeURIComponent(token)}`,
    playbackUrl: row.playlistKey ? `${base}${tokenUrl(rel(row.playlistKey), token)}` : null,
  }
}

export const ttlFrom = (v: unknown) => {
  if (v === undefined || v === null) return DEFAULT_TTL
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 60 || v > MAX_TTL) throw new HttpError(400, 'expiresIn must be between 60 seconds and 30 days, in seconds.')
  return v
}
