/** Server-side access to media assets. Every query is scoped to a workspace. */
import { randomBytes } from 'node:crypto'
import { auth, pool } from '@/lib/auth'
import type { MediaAsset, MediaStatus, MediaType, Rendition } from './types'

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
  }
}

const SELECT = `select a.*, u.name as "createdByName" from "asset" a left join "user" u on u.id = a."createdBy"`

export async function listAssets(orgId: string): Promise<AssetRow[]> {
  const { rows } = await pool.query<AssetRow>(`${SELECT} where a."organizationId" = $1 order by a."createdAt" desc limit 500`, [orgId])
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
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
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
