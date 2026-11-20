/** Server-side access to media assets. Every query is scoped to a workspace. */
import { randomBytes } from 'node:crypto'
import { auth, baseURL, pool } from '../auth.mts'
import type { MediaAsset, MediaStatus, MediaType, ModerationFlag, ModerationState, Rendition } from './types.mts'

import type { UploadPolicy } from './types.mts'

export type AssetRow = {
  revisionId: string
  uploadPolicy: UploadPolicy | null
  uploadExpiresAt: Date | null
  storageBackend: 'local' | 's3'
  id: string
  organizationId: string
  createdBy: string | null
  createdByName?: string | null
  uploadedVia?: string | null
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
  playback: 'public' | 'signed'
  upload: { uploadId: string; partSize: number; partCount: number } | null
  playlists: Partial<Record<'hevc' | 'av1', string>>
  captions?: { lang: string; label: string; source: 'auto' | 'upload'; status: 'queued' | 'processing' | 'ready' | 'failed'; error: string | null }[]
}

/** the largest file anyone can upload; above SINGLE_PUT_BYTES it has to go in parts */
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 50 * 1024 ** 3)
/** one S3 PUT tops out at 5 GiB */
export const SINGLE_PUT_BYTES = 5 * 1024 ** 3

export const newAssetId = () => `ast_${randomBytes(9).toString('base64url').replace(/[-_]/g, '').slice(0, 12).toLowerCase()}`
export const prefixOf = (a: Pick<AssetRow, 'organizationId' | 'id'> & Partial<Pick<AssetRow, 'originalKey'>>) =>
  a.originalKey ? a.originalKey.slice(0, a.originalKey.lastIndexOf('/')) : `${a.organizationId}/${a.id}`

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
    createdBy: a.createdByName ?? a.uploadedVia ?? null,
    // the thumbnail is made early in the pipeline, so it shows while the asset is still encoding
    thumbUrl: fileUrl(a, a.thumbKey),
    posterUrl: fileUrl(a, a.posterKey ?? a.thumbKey),
    playbackUrl: a.status === 'ready' ? fileUrl(a, a.playlistKey) : null,
    playbackUrls: a.status === 'ready' ? Object.fromEntries(Object.entries(a.playlists ?? {}).map(([c, k]) => [c, fileUrl(a, k ?? null)])) : {},
    folderId: a.folderId ?? null,
    collectionIds: a.collectionIds ?? [],
    metadata: a.metadata ?? {},
    moderation: a.moderation ?? 'approved',
    moderationFlags: a.moderationFlags ?? [],
    moderationNote: a.moderationNote ?? null,
    playback: a.playback ?? 'public',
    captions: (a.captions ?? []).map((c) => ({ ...c, url: c.status === 'ready' ? `/api/media/${a.id}/captions/${c.lang}.vtt` : null })),
  }
}

/** The DTO for API and webhook consumers: file URLs are absolute, so they work outside the dashboard. */
export function apiAsset(a: AssetRow): MediaAsset {
  const d = toDTO(a)
  const abs = (u: string | null) => (u ? `${baseURL}${u}` : null)
  const urls = Object.fromEntries(Object.entries(d.playbackUrls).map(([c, u]) => [c, abs(u ?? null)]))
  return { ...d, thumbUrl: abs(d.thumbUrl), posterUrl: abs(d.posterUrl), playbackUrl: abs(d.playbackUrl), playbackUrls: urls, captions: d.captions.map((c) => ({ ...c, url: abs(c.url) })) }
}

export const ASSET_FIELDS = `a.*, u.name as "createdByName",
    coalesce((select array_agg(ca."collectionId" order by ca."addedAt") from "collection_asset" ca where ca."assetId" = a.id), '{}') as "collectionIds",
    coalesce((select json_agg(json_build_object('lang', c.lang, 'label', c.label, 'source', c.source, 'status', c.status, 'error', c.error) order by c.source, c.label)
      from "caption" c where c."assetId" = a.id), '[]') as "captions"`
const SELECT = `select ${ASSET_FIELDS} from "asset" a left join "user" u on u.id = a."createdBy"`

export async function getAssetRow(id: string, orgId?: string): Promise<AssetRow | null> {
  const { rows } = orgId
    ? await pool.query<AssetRow>(`${SELECT} where a."deletedAt" is null and a.id = $1 and a."organizationId" = $2`, [id, orgId])
    : await pool.query<AssetRow>(`${SELECT} where a."deletedAt" is null and a.id = $1`, [id])
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
    if (e instanceof HttpError) {
      const retryAfter = (e as HttpError & { retryAfter?: number }).retryAfter
      return Response.json({ error: e.message }, { status: e.status, headers: retryAfter ? { 'Retry-After': String(retryAfter) } : undefined })
    }
    console.error('[media]', e)
    return Response.json({ error: 'Something went wrong on our side. Try again.' }, { status: 500 })
  }
}
