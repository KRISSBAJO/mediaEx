/** Server-side access to media assets. Every query is scoped to a workspace. */
import { randomBytes } from 'node:crypto'
import { auth, pool } from '../auth.mts'
import type { MediaAsset, MediaStatus, MediaType, ModerationFlag, ModerationState, Rendition, SearchQuery } from './types.mts'

export type AssetRow = {
  id: string
  organizationId: string
  createdBy: string | null
  createdByName?: string | null
  title: string
  type: MediaType
  status: MediaStatus
  stage: number
  progress: number
  error: string | null
  fileName: string
  mimeType: string | null
  size: string // bigint comes back as a string
  outputSize: string
  duration: number
  width: number | null
  height: number | null
  sourceInfo: string | null
  renditions: Rendition[]
  tags: string[]
  originalKey: string
  thumbKey: string | null
  posterKey: string | null
  playlistKey: string | null
  attempts: number
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
  folderId: string | null
  collectionIds?: string[]
  metadata: Record<string, unknown>
  moderation: ModerationState
  moderationFlags: ModerationFlag[]
  moderationNote: string | null
  moderatedBy: string | null
  moderatedAt: Date | null
}

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 ** 3) // 5 GiB: one S3 PUT

export const newAssetId = () => `ast_${randomBytes(9).toString('base64url').replace(/[-_]/g, '').slice(0, 12).toLowerCase()}`
export const prefixOf = (a: Pick<AssetRow, 'organizationId' | 'id'>) => `${a.organizationId}/${a.id}`

/** URL for a stored file of an asset, relative to the app. */
const fileUrl = (a: AssetRow, key: string | null) => (key ? `/api/media/${a.id}/${key.slice(prefixOf(a).length + 1)}` : null)

export function toDTO(a: AssetRow): MediaAsset {
  return {
    id: a.id,
    title: a.title,
    type: a.type,
    status: a.status,
    stage: a.stage,
    progress: Math.round(a.progress * 10) / 10,
    error: a.error,
    fileName: a.fileName,
    size: Number(a.size),
    outputSize: Number(a.outputSize),
    duration: a.duration,
    width: a.width,
    height: a.height,
    sourceInfo: a.sourceInfo,
    renditions: a.renditions ?? [],
    tags: a.tags ?? [],
    createdAt: new Date(a.createdAt).toISOString(),
    readyAt: a.readyAt ? new Date(a.readyAt).toISOString() : null,
    createdBy: a.createdByName ?? null,
    // the thumbnail is made early in the pipeline, so it shows while the asset is still encoding
    thumbUrl: fileUrl(a, a.thumbKey),
    posterUrl: fileUrl(a, a.posterKey ?? a.thumbKey),
    playbackUrl: a.status === 'ready' ? fileUrl(a, a.playlistKey) : null,
    folderId: a.folderId ?? null,
    collectionIds: a.collectionIds ?? [],
    metadata: a.metadata ?? {},
    moderation: a.moderation ?? 'approved',
    moderationFlags: a.moderationFlags ?? [],
    moderationNote: a.moderationNote ?? null,
  }
}

const SELECT = `select a.*, u.name as "createdByName",
    coalesce((select array_agg(ca."collectionId" order by ca."addedAt") from "collection_asset" ca where ca."assetId" = a.id), '{}') as "collectionIds"
  from "asset" a left join "user" u on u.id = a."createdBy"`

export async function listAssets(orgId: string): Promise<AssetRow[]> {
  const { rows } = await pool.query<AssetRow>(`${SELECT} where a."organizationId" = $1 order by a."createdAt" desc limit 500`, [orgId])
  return rows
}

/** Escapes text for an ILIKE pattern (backslash is Postgres' default escape character). */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
const contains = (s: string) => `%${escapeLike(s)}%`

const SORT_SQL = {
  new: 'a."createdAt" desc',
  old: 'a."createdAt" asc',
  name: 'lower(a.title) asc, a."createdAt" desc',
  size: 'a.size desc',
  long: 'a.duration desc, a."createdAt" desc',
} as const

const INTERVALS = { '1d': '1 day', '7d': '7 days', '30d': '30 days', '365d': '365 days' } as const

/**
 * Searches a workspace's assets. Every word of `q` must appear in the title, file name, source info or a tag
 * (case-insensitive, partial words count); every other filter narrows further.
 */
export async function searchAssets(orgId: string, query: SearchQuery, limit = 500): Promise<AssetRow[]> {
  const where = ['a."organizationId" = $1']
  const args: unknown[] = [orgId]
  const arg = (v: unknown) => (args.push(v), `$${args.length}`)

  const words = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
  for (const w of words) {
    const p = arg(contains(w))
    where.push(
      `(a.title ilike ${p} or a."fileName" ilike ${p} or coalesce(a."sourceInfo", '') ilike ${p} or exists (select 1 from unnest(a.tags) t where t ilike ${p})` +
        ` or exists (select 1 from jsonb_each_text(a.metadata) m where m.value ilike ${p}))`,
    )
  }
  if (query.folder === 'root') where.push('a."folderId" is null')
  else if (query.folder) where.push(`a."folderId" = ${arg(query.folder)}`)
  if (query.collection) where.push(`exists (select 1 from "collection_asset" ca where ca."assetId" = a.id and ca."collectionId" = ${arg(query.collection)})`)
  if (query.type?.length) where.push(`a.type = any(${arg(query.type)}::text[])`)
  if (query.tags?.length) where.push(`a.tags @> ${arg(query.tags)}::text[]`)
  if (query.status?.length) {
    const parts = query.status.map((s) => (s === 'ready' ? `a.status = 'ready'` : s === 'failed' ? `a.status = 'failed'` : `a.status in ('uploading', 'queued', 'processing')`))
    where.push(`(${parts.join(' or ')})`)
  }
  // dropdown fields: the value equals the option (single) or contains it (multi-select)
  for (const [field, option] of Object.entries(query.meta ?? {})) where.push(`a.metadata->${arg(field)} @> to_jsonb(${arg(option)}::text)`)
  if (query.date) where.push(`a."createdAt" > now() - ${arg(INTERVALS[query.date])}::interval`)

  // relevance: titles starting with the search, then titles containing it, then the rest; newest first within each
  const sort = query.sort ?? (words.length ? 'relevance' : 'new')
  const phrase = words.join(' ')
  const order =
    sort === 'relevance' && words.length
      ? `case when lower(a.title) like ${arg(escapeLike(phrase) + '%')} then 0 when a.title ilike ${arg(contains(phrase))} then 1 else 2 end, a."createdAt" desc`
      : SORT_SQL[sort === 'relevance' ? 'new' : sort]

  const { rows } = await pool.query<AssetRow>(`${SELECT} where ${where.join(' and ')} order by ${order} limit ${Math.min(1000, Math.max(1, limit))}`, args)
  return rows
}

export async function getAssetRow(id: string, orgId?: string): Promise<AssetRow | null> {
  const { rows } = orgId
    ? await pool.query<AssetRow>(`${SELECT} where a.id = $1 and a."organizationId" = $2`, [id, orgId])
    : await pool.query<AssetRow>(`${SELECT} where a.id = $1`, [id])
  return rows[0] ?? null
}

/* ------------------------------------------------ who is asking */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The signed-in user and their active workspace, checked against the member table. */
export async function requireMember(headers: Headers) {
  const session = await auth.api.getSession({ headers })
  if (!session) throw new HttpError(401, 'Sign in to continue.')
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw new HttpError(400, 'Choose a workspace first.')
  const { rows } = await pool.query<{ role: string }>('select role from "member" where "userId" = $1 and "organizationId" = $2 limit 1', [session.user.id, orgId])
  if (!rows[0]) throw new HttpError(403, 'You’re not a member of this workspace.')
  return { user: session.user, orgId, role: rows[0].role.split(',')[0] }
}

/** Is this user a member of the asset's workspace (any workspace, not only the active one)? */
export async function isMemberOf(headers: Headers, orgId: string) {
  const session = await auth.api.getSession({ headers })
  if (!session) return false
  const { rows } = await pool.query('select 1 from "member" where "userId" = $1 and "organizationId" = $2 limit 1', [session.user.id, orgId])
  return rows.length > 0
}

/** Turns thrown errors into JSON responses for route handlers. */
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status })
    console.error('[media]', e)
    return Response.json({ error: 'Something went wrong on our side. Try again.' }, { status: 500 })
  }
}
