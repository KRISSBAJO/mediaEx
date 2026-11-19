/**
 * MediaEX media API (backend service). Web-standard Request → Response handlers, routed by path:
 *
 *   GET    /api/assets                       the active workspace's assets
 *   GET    /api/assets/:id                   one asset
 *   PATCH  /api/assets/:id                   rename / retag            { title?, tags? }
 *   DELETE /api/assets/:id                   delete asset and its files
 *   POST   /api/assets/:id/retry             run the pipeline again
 *   POST   /api/uploads                      start an upload           { fileName, size, mimeType }
 *   PUT    /api/uploads/:id                  the file itself (local-disk storage only)
 *   POST   /api/uploads/:id/complete         check it arrived, queue it
 *   GET    /api/media/:id/info               public player info (share/embed page)
 *   GET    /api/media/:id/<file>             playback files, public by link; /original is members-only
 *   GET    /api/media/:id/transform?w=&h=&…  resized/cropped/re-encoded image, cached (see transform.mts)
 *
 *   GET    /api/assets?q=&folder=&…         search: same parameters as the Library URL (see parseQuery)
 *   (folders, collections, tags, saved searches and bulk actions: see library.mts)
 *
 * The frontend forwards these paths unchanged (see app/api/*).
 */
import { pool } from '../auth.mts'
import { guessType, normaliseTag, parseQuery } from './types.mts'
import { MAX_UPLOAD_BYTES, HttpError, getAssetRow, handle, isMemberOf, newAssetId, prefixOf, requireMember, searchAssets, toDTO } from './assets.mts'
import { mergeMetadata, handleFields } from './fields.mts'
import { handleModeration, initialModeration, isPublic } from './moderation.mts'
import { bulk, handleLibrary } from './library.mts'
import { isLocal, storage } from './storage.mts'
import { transform } from './transform.mts'
import { kickWorker } from './worker.mts'

const SAFE_REL = /^[A-Za-z0-9_-][A-Za-z0-9._/-]*$/
const noStore = { 'Cache-Control': 'no-store' }

async function body<T>(req: Request) {
  return (await req.json().catch(() => null)) as T | null
}

/** Uploads need storage that survives a redeploy. In production, refuse them unless a bucket or a mounted MEDIA_DIR is set. */
function assertDurableStorage() {
  if (process.env.NODE_ENV === 'production' && !isDurable()) {
    throw new HttpError(503, 'Media storage isn’t configured on the server yet, so uploads are turned off.')
  }
}
export const isDurable = () => storage().kind === 's3' || Boolean(process.env.MEDIA_DIR)

/* ------------------------------------------------ assets */
async function listAll(req: Request) {
  const { orgId } = await requireMember(req.headers)
  const query = parseQuery(new URL(req.url).searchParams)
  return Response.json({ assets: (await searchAssets(orgId, query)).map(toDTO) }, { headers: noStore })
}

/** A folder id from a request, checked to belong to the workspace (null = no folder). */
async function folderOf(orgId: string, v: unknown) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || !/^fld_[a-z0-9]{4,24}$/.test(v)) throw new HttpError(404, 'That folder doesn’t exist.')
  const { rows } = await pool.query('select id from "folder" where id = $1 and "organizationId" = $2', [v, orgId])
  if (!rows[0]) throw new HttpError(404, 'That folder doesn’t exist.')
  return v
}

async function one(req: Request, id: string) {
  const { orgId } = await requireMember(req.headers)
  const row = await getAssetRow(id, orgId)
  if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')

  if (req.method === 'GET') return Response.json({ asset: toDTO(row) }, { headers: noStore })

  if (req.method === 'PATCH') {
    const b = await body<{ title?: unknown; tags?: unknown; folderId?: unknown; metadata?: unknown }>(req)
    const title = b?.title === undefined ? row.title : typeof b.title === 'string' ? b.title.trim() : ''
    if (!title || title.length > 200) throw new HttpError(400, 'Titles need 1–200 characters.')
    let tags = row.tags
    if (b?.tags !== undefined) {
      if (!Array.isArray(b.tags)) throw new HttpError(400, 'Tags must be a list.')
      tags = [...new Set(b.tags.filter((t): t is string => typeof t === 'string').map(normaliseTag).filter(Boolean))]
      if (tags.length > 20 || tags.some((t) => t.length > 32)) throw new HttpError(400, 'Use up to 20 tags of 32 characters or fewer.')
    }
    const folderId = b?.folderId === undefined ? row.folderId : await folderOf(orgId, b.folderId)
    const metadata = b?.metadata === undefined ? row.metadata : await mergeMetadata(orgId, row.metadata ?? {}, b.metadata)
    await pool.query(`update "asset" set title = $2, tags = $3, "folderId" = $4, metadata = $5, "updatedAt" = now() where id = $1`, [id, title, tags, folderId, JSON.stringify(metadata)])
    return Response.json({ asset: toDTO((await getAssetRow(id, orgId))!) })
  }

  if (req.method === 'DELETE') {
    await pool.query(`delete from "asset" where id = $1`, [id])
    await storage().removePrefix(prefixOf(row))
    return new Response(null, { status: 204 })
  }
  throw new HttpError(405, 'Method not allowed')
}

async function retry(req: Request, id: string) {
  const { orgId } = await requireMember(req.headers)
  const row = await getAssetRow(id, orgId)
  if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
  if (row.status !== 'ready' && row.status !== 'failed') throw new HttpError(409, 'This asset is still being processed.')
  await pool.query(`update "asset" set status = 'queued', stage = 1, progress = 0, error = null, attempts = 0, "updatedAt" = now() where id = $1`, [id])
  // cached transformations were made from the old outputs: start fresh
  await pool.query(`delete from "asset_variant" where "assetId" = $1`, [id])
  await storage().removePrefix(`${prefixOf(row)}/derived`)
  kickWorker()
  return Response.json({ asset: toDTO((await getAssetRow(id, orgId))!) })
}

/* ------------------------------------------------ uploads */
async function startUpload(req: Request) {
  const { user, orgId } = await requireMember(req.headers)
  assertDurableStorage()
  const b = await body<{ fileName?: unknown; size?: unknown; mimeType?: unknown; folderId?: unknown }>(req)
  const fileName = typeof b?.fileName === 'string' ? b.fileName.trim().slice(0, 255) : ''
  const size = typeof b?.size === 'number' ? Math.floor(b.size) : 0
  const mimeType = typeof b?.mimeType === 'string' ? b.mimeType.slice(0, 120) : null
  if (!fileName) throw new HttpError(400, 'The file needs a name.')
  if (size <= 0) throw new HttpError(400, `${fileName} is empty.`)
  if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, `${fileName} is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 ** 3)} GB limit.`)
  const type = guessType(fileName, mimeType)
  if (!type) throw new HttpError(415, `${fileName} isn’t a video, audio or image file MediaEX can process.`)

  const folderId = await folderOf(orgId, b?.folderId)
  const id = newAssetId()
  const ext = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1]?.toLowerCase()
  const originalKey = `${orgId}/${id}/original${ext ? `.${ext}` : ''}`
  const title = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || fileName
  await pool.query(
    `insert into "asset" (id, "organizationId", "createdBy", title, type, status, "fileName", "mimeType", size, "originalKey", "folderId", moderation)
     values ($1, $2, $3, $4, $5, 'uploading', $6, $7, $8, $9, $10, $11)`,
    [id, orgId, user.id, title, type, fileName, mimeType, size, originalKey, folderId, await initialModeration(orgId)],
  )
  const row = await getAssetRow(id, orgId)
  return Response.json({ asset: toDTO(row!), upload: await storage().uploadTarget(originalKey, id) }, { status: 201 })
}

async function receiveUpload(req: Request, id: string) {
  const { orgId } = await requireMember(req.headers)
  const row = await getAssetRow(id, orgId)
  if (!row) throw new HttpError(404, 'That upload doesn’t exist.')
  if (row.status !== 'uploading') throw new HttpError(409, 'This file has already been uploaded.')
  const store = storage()
  if (!isLocal(store)) throw new HttpError(400, 'Upload to the storage URL you were given instead.')
  if (!req.body) throw new HttpError(400, 'No file was sent.')
  try {
    return Response.json({ received: await store.write(row.originalKey, req.body, Number(row.size)) })
  } catch (e) {
    if (e instanceof Error && e.message === 'UPLOAD_TOO_LARGE') throw new HttpError(413, 'The file is bigger than announced.')
    throw e
  }
}

async function completeUpload(req: Request, id: string) {
  const { orgId } = await requireMember(req.headers)
  const row = await getAssetRow(id, orgId)
  if (!row) throw new HttpError(404, 'That upload doesn’t exist.')
  if (row.status !== 'uploading') return Response.json({ asset: toDTO(row) })
  const stored = await storage().size(row.originalKey)
  if (stored === null) throw new HttpError(400, 'The file never arrived. Try uploading it again.')
  if (stored !== Number(row.size)) throw new HttpError(400, `Only ${stored} of ${row.size} bytes arrived. Try uploading it again.`)
  await pool.query(`update "asset" set status = 'queued', stage = 1, progress = 0, "updatedAt" = now() where id = $1`, [id])
  kickWorker()
  return Response.json({ asset: toDTO((await getAssetRow(id, orgId))!) })
}

/* ------------------------------------------------ playback */
async function media(req: Request, id: string, rel: string) {
  const row = await getAssetRow(id)
  if (!row) return new Response('Not found', { status: 404 })
  // until an asset is approved, only its workspace can see it
  const canView = async () => isPublic(row) || (await isMemberOf(req.headers, row.organizationId))

  if (rel === 'info') {
    if (!(await canView())) return Response.json({ error: 'Not found' }, { status: 404 })
    // what the public player needs; nothing about the workspace or who uploaded it
    if (row.status === 'uploading') return Response.json({ error: 'Not found' }, { status: 404 })
    const a = toDTO(row)
    const info = { id: a.id, title: a.title, type: a.type, status: a.status, progress: a.progress, duration: a.duration, width: a.width, height: a.height, renditions: a.renditions, thumbUrl: a.thumbUrl, posterUrl: a.posterUrl, playbackUrl: a.playbackUrl }
    return Response.json(info, { headers: noStore })
  }
  if (rel === 'transform') return transform(req, id, canView, (a) => isMemberOf(req.headers, a.organizationId))
  if (rel === 'original') {
    if (!(await isMemberOf(req.headers, row.organizationId))) return new Response('Not found', { status: 404 })
    return storage().serve(row.originalKey, req, { download: row.fileName })
  }
  const publicFile = rel === 'thumb.jpg' || rel === 'thumb.png' || rel === 'poster.jpg' || (rel.startsWith('hls/') && row.status === 'ready')
  if (!publicFile || !SAFE_REL.test(rel) || rel.split('/').includes('..')) return new Response('Not found', { status: 404 })
  if (!(await canView())) return new Response('Not found', { status: 404 })
  const res = await storage().serve(`${prefixOf(row)}/${rel}`, req)
  res.headers.set('Access-Control-Allow-Origin', '*') // players on other sites may load the stream
  return res
}

/* ------------------------------------------------ router */
export async function handleMedia(req: Request, pathname: string): Promise<Response | null> {
  const m = req.method
  const parts = pathname.split('/').filter(Boolean) // ['api', 'assets', ...]
  if (parts[0] !== 'api' || !['assets', 'uploads', 'media', 'folders', 'collections', 'tags', 'searches', 'fields', 'moderation'].includes(parts[1])) return null
  if (parts[1] === 'fields' && parts.length <= 3) return handle(() => handleFields(req, parts[2]))
  if (['folders', 'collections', 'tags', 'searches'].includes(parts[1])) return handle(() => handleLibrary(req, parts))
  if (parts[1] === 'moderation' && parts.length === 3) return handle(() => handleModeration(req, parts[2]))
  if (parts[1] === 'assets' && parts[2] === 'bulk' && parts.length === 3) return handle(() => bulk(req))
  let id: string | undefined
  try {
    id = parts[2] === undefined ? undefined : decodeURIComponent(parts[2])
  } catch {
    return Response.json({ error: 'Invalid ID' }, { status: 400 })
  }
  if (id !== undefined && !/^ast_[a-z0-9]{6,20}$/.test(id)) return Response.json({ error: 'Not found' }, { status: 404 })

  return handle(async () => {
    if (parts[1] === 'assets') {
      if (!id && m === 'GET') return listAll(req)
      if (id && parts.length === 3) return one(req, id)
      if (id && parts[3] === 'retry' && parts.length === 4 && m === 'POST') return retry(req, id)
    }
    if (parts[1] === 'uploads') {
      if (!id && m === 'POST') return startUpload(req)
      if (id && parts.length === 3 && m === 'PUT') return receiveUpload(req, id)
      if (id && parts[3] === 'complete' && parts.length === 4 && m === 'POST') return completeUpload(req, id)
    }
    if (parts[1] === 'media' && id && parts.length > 3 && (m === 'GET' || m === 'HEAD')) return media(req, id, parts.slice(3).join('/'))
    throw new HttpError(404, 'Not found')
  })
}
