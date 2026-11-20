/**
 * MediaEX media API (backend service). Web-standard Request → Response handlers, routed by path:
 *
 *   GET    /api/assets                       the active workspace's assets
 *   GET    /api/assets/:id                   one asset
 *   PATCH  /api/assets/:id                   rename / retag            { title?, tags? }
 *   DELETE /api/assets/:id                   delete asset and its files
 *   POST   /api/assets/:id/retry             run the pipeline again
 *   POST   /api/uploads                      start an upload           { fileName, size, mimeType, multipart? }
 *   PUT    /api/uploads/:id                  the file itself (local-disk storage only)
 *   POST   /api/uploads/:id/parts            URLs for parts            { numbers: [1, 2, …] }      (multipart)
 *   GET    /api/uploads/:id/parts            which parts have arrived, to resume                   (multipart)
 *   PUT    /api/uploads/:id/parts/:n         one part (local-disk storage only)                    (multipart)
 *   POST   /api/uploads/:id/complete         check it arrived (joining the parts), queue it
 *   GET    /api/media/:id/info               public player info (share/embed page)
 *   GET    /api/media/:id/<file>             playback files, public by link; /original is members-only
 *   GET    /api/media/:id/transform?w=&h=&…  resized/cropped/re-encoded image, cached (see transform.mts)
 *   POST   /api/assets/:id/playback-token    a signed playback link    { expiresIn? }  (see playback.mts)
 *   POST   /api/media/:id/views              player heartbeat · GET /api/analytics  (see analytics.mts)
 *   GET    /api/assets/:id/captions          caption tracks; POST …/generate, PUT/DELETE …/:lang  (see captions.mts)
 *   GET    /api/media/:id/captions/:lang.vtt a caption track (same access as playback)
 *
 *   GET    /api/assets?q=&folder=&…         search: same parameters as the Library URL (see parseQuery)
 *   (folders, collections, tags, saved searches and bulk actions: see library.mts)
 *
 *   (API keys: keys.mts · webhooks: webhooks.mts · the public, key-authenticated API: v1.mts)
 *
 * The frontend forwards these paths unchanged (see app/api/*).
 */
import { pool } from '../auth.mts'
import { guessType, normaliseTag, parseQuery } from './types.mts'
import { MAX_UPLOAD_BYTES, SINGLE_PUT_BYTES, HttpError, apiAsset, getAssetRow, handle, isMemberOf, newAssetId, prefixOf, searchAssets, toDTO, type AssetRow } from './assets.mts'
import { handleKeys, sessionActor, type Actor } from './keys.mts'
import { emitAsset, handleWebhooks } from './webhooks.mts'
import { mergeMetadata, handleFields } from './fields.mts'
import { handleModeration, initialModeration, isPublic } from './moderation.mts'
import { bulk, handleLibrary } from './library.mts'
import { isLocal, storage } from './storage.mts'
import { transform } from './transform.mts'
import { kickWorker } from './worker.mts'
import { apiBase, handleV1 } from './v1.mts'
import { analyticsFor, recordBeat } from './analytics.mts'
import { handleEncoding } from './encoding.mts'
import { captionKey, handleCaptions } from './captions.mts'
import { assertMinutes, assertStorage, handleBilling } from './billing.mts'
import { PLAYBACK_POLICIES, handlePlayback, playbackLinks, tokenOf, tokenUrl, tokenisePlaylist, ttlFrom, verifyPlayback, type PlaybackPolicy } from './playback.mts'

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
/** Dashboard callers get app-relative URLs; API-key callers get absolute ones. */
export const dtoFor = (a: Actor, row: AssetRow) => (a.via === 'key' ? apiAsset(row) : toDTO(row))

async function listAll(req: Request) {
  const { orgId } = await sessionActor(req.headers)
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

export async function one(a: Actor, req: Request, id: string) {
  const { orgId } = a
  const row = await getAssetRow(id, orgId)
  if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')

  if (req.method === 'GET') return Response.json({ asset: dtoFor(a, row) }, { headers: noStore })

  if (req.method === 'PATCH') {
    const b = await body<{ title?: unknown; tags?: unknown; folderId?: unknown; metadata?: unknown; playback?: unknown }>(req)
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
    if (b?.playback !== undefined && !PLAYBACK_POLICIES.includes(b.playback as PlaybackPolicy)) throw new HttpError(400, 'playback must be "public" or "signed".')
    const playback = (b?.playback as PlaybackPolicy | undefined) ?? row.playback
    await pool.query(`update "asset" set title = $2, tags = $3, "folderId" = $4, metadata = $5, playback = $6, "updatedAt" = now() where id = $1`, [
      id, title, tags, folderId, JSON.stringify(metadata), playback,
    ])
    return Response.json({ asset: dtoFor(a, (await getAssetRow(id, orgId))!) })
  }

  if (req.method === 'DELETE') {
    await emitAsset(row, 'asset.deleted') // queued before the row goes, so the payload still has the asset
    await pool.query(`delete from "asset" where id = $1`, [id])
    if (row.upload) await storage().multipartAbort(row.originalKey, row.upload.uploadId).catch(() => {})
    await storage().removePrefix(prefixOf(row))
    return new Response(null, { status: 204 })
  }
  throw new HttpError(405, 'Method not allowed')
}

export async function retry(a: Actor, id: string) {
  const { orgId } = a
  const row = await getAssetRow(id, orgId)
  if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
  if (row.status !== 'ready' && row.status !== 'failed') throw new HttpError(409, 'This asset is still being processed.')
  await pool.query(`update "asset" set status = 'queued', stage = 1, progress = 0, error = null, attempts = 0, "updatedAt" = now() where id = $1`, [id])
  // cached transformations were made from the old outputs: start fresh
  await pool.query(`delete from "asset_variant" where "assetId" = $1`, [id])
  await storage().removePrefix(`${prefixOf(row)}/derived`)
  kickWorker()
  return Response.json({ asset: dtoFor(a, (await getAssetRow(id, orgId))!) })
}

/** A signed link for one viewer: works for public and signed assets alike, so callers needn't check first. */
export async function playbackToken(a: Actor, req: Request, id: string) {
  const row = await getAssetRow(id, a.orgId)
  if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
  if (row.status !== 'ready') throw new HttpError(409, 'This asset isn’t ready to play yet.')
  const b = await body<{ expiresIn?: unknown }>(req)
  return Response.json(await playbackLinks(row, ttlFrom(b?.expiresIn), a.via === 'key'), { status: 201, headers: noStore })
}

/** caption tracks for an asset in the caller's workspace */
export async function captions(a: Actor, req: Request, id: string, lang?: string) {
  const row = await getAssetRow(id, a.orgId)
  if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
  return handleCaptions(req, row, lang, a.via === 'key')
}

/* ------------------------------------------------ uploads */
export async function startUpload(a: Actor, req: Request) {
  const { orgId } = a
  assertDurableStorage()
  const b = await body<{ fileName?: unknown; size?: unknown; mimeType?: unknown; folderId?: unknown; multipart?: unknown }>(req)
  const fileName = typeof b?.fileName === 'string' ? b.fileName.trim().slice(0, 255) : ''
  const size = typeof b?.size === 'number' ? Math.floor(b.size) : 0
  const mimeType = typeof b?.mimeType === 'string' ? b.mimeType.slice(0, 120) : null
  if (!fileName) throw new HttpError(400, 'The file needs a name.')
  if (size <= 0) throw new HttpError(400, `${fileName} is empty.`)
  if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, `${fileName} is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 ** 3)} GB limit.`)
  const type = guessType(fileName, mimeType)
  if (!type) throw new HttpError(415, `${fileName} isn’t a video, audio or image file MediaEX can process.`)
  await assertStorage(orgId, size)

  const folderId = await folderOf(orgId, b?.folderId)
  const id = newAssetId()
  const ext = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1]?.toLowerCase()
  const originalKey = `${orgId}/${id}/original${ext ? `.${ext}` : ''}`
  const title = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || fileName
  await pool.query(
    `insert into "asset" (id, "organizationId", "createdBy", "uploadedVia", title, type, status, "fileName", "mimeType", size, "originalKey", "folderId", moderation)
     values ($1, $2, $3, $4, $5, $6, 'uploading', $7, $8, $9, $10, $11, $12)`,
    [id, orgId, a.userId, a.via === 'key' ? `API key: ${a.keyName}` : null, title, type, fileName, mimeType, size, originalKey, folderId, await initialModeration(orgId)],
  )
  // big files, and anyone who asks, upload in parts: each part can be retried, and an interrupted upload resumed
  if (b?.multipart === true || size > SINGLE_PUT_BYTES) {
    const partSize = partSizeFor(size)
    const plan = { uploadId: await storage().multipartStart(originalKey), partSize, partCount: Math.ceil(size / partSize) }
    await pool.query(`update "asset" set upload = $2 where id = $1`, [id, JSON.stringify(plan)])
    const base = a.via === 'key' ? `${apiBase()}/api/v1` : '/api'
    return Response.json(
      { asset: dtoFor(a, (await getAssetRow(id, orgId))!), upload: { kind: 'multipart', partSize, partCount: plan.partCount, parts: `${base}/uploads/${id}/parts` } },
      { status: 201 },
    )
  }
  const row = await getAssetRow(id, orgId)
  const upload = { kind: 'single' as const, ...(await storage().uploadTarget(originalKey, id)) }
  // local disk: key callers send the file to the v1 route, with their key, at an absolute URL
  if (a.via === 'key' && upload.url.startsWith('/')) upload.url = `${apiBase()}/api/v1/uploads/${id}`
  return Response.json({ asset: dtoFor(a, row!), upload }, { status: 201 })
}

const MiB = 1024 ** 2
/** at least 16 MiB, and few enough parts to stay under the 10,000-part limit of S3 */
const partSizeFor = (size: number) => Math.max(16 * MiB, Math.ceil(size / 9000 / MiB) * MiB)
const partLength = (size: number, plan: NonNullable<AssetRow['upload']>, n: number) => (n < plan.partCount ? plan.partSize : size - plan.partSize * (plan.partCount - 1))

async function inParts(a: Actor, id: string) {
  const row = await getAssetRow(id, a.orgId)
  if (!row) throw new HttpError(404, 'That upload doesn’t exist.')
  if (row.status !== 'uploading' || !row.upload) throw new HttpError(409, row.status === 'uploading' ? 'This upload isn’t in parts.' : 'This file has already been uploaded.')
  return { row, plan: row.upload }
}

/** GET: what has arrived (to resume) · POST { numbers }: where to send those parts */
export async function uploadParts(a: Actor, req: Request, id: string) {
  const { row, plan } = await inParts(a, id)
  const store = storage()
  if (req.method === 'GET') {
    const stored = await store.listParts(row.originalKey, plan.uploadId)
    const size = Number(row.size)
    // a part only counts when it's complete
    const done = stored.filter((p) => p.number >= 1 && p.number <= plan.partCount && p.size === partLength(size, plan, p.number))
    return Response.json({ partSize: plan.partSize, partCount: plan.partCount, uploaded: done.map((p) => ({ number: p.number, size: p.size })) }, { headers: noStore })
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')
  const b = await body<{ numbers?: unknown }>(req)
  const numbers = Array.isArray(b?.numbers) ? b.numbers : []
  if (!numbers.length || numbers.length > 100 || !numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= plan.partCount)) {
    throw new HttpError(400, `Ask for 1–100 part numbers between 1 and ${plan.partCount}.`)
  }
  const size = Number(row.size)
  const parts = await Promise.all(
    (numbers as number[]).map(async (n) => {
      const t = await store.partTarget(row.originalKey, plan.uploadId, n, id)
      if (t.url.startsWith('/') && a.via === 'key') t.url = `${apiBase()}/api/v1/uploads/${id}/parts/${n}`
      return { number: n, size: partLength(size, plan, n), ...t }
    }),
  )
  return Response.json({ parts }, { headers: noStore })
}

/** PUT one part (local-disk storage only; buckets take parts directly) */
export async function receivePart(a: Actor, req: Request, id: string, n: number) {
  const { row, plan } = await inParts(a, id)
  const store = storage()
  if (!isLocal(store)) throw new HttpError(400, 'Upload parts to the URLs you were given instead.')
  if (!Number.isInteger(n) || n < 1 || n > plan.partCount) throw new HttpError(404, 'That part doesn’t exist.')
  if (!req.body) throw new HttpError(400, 'No data was sent.')
  const expected = partLength(Number(row.size), plan, n)
  try {
    return Response.json({ number: n, received: await store.writePart(row.originalKey, n, req.body, expected) })
  } catch (e) {
    if (e instanceof Error && (e.message === 'UPLOAD_TOO_LARGE' || e.message === 'PART_SHORT')) throw new HttpError(400, `Part ${n} must be exactly ${expected} bytes.`)
    throw e
  }
}

export async function receiveUpload(a: Actor, req: Request, id: string) {
  const { orgId } = a
  const row = await getAssetRow(id, orgId)
  if (!row) throw new HttpError(404, 'That upload doesn’t exist.')
  if (row.status !== 'uploading') throw new HttpError(409, 'This file has already been uploaded.')
  const store = storage()
  if (!isLocal(store)) throw new HttpError(400, 'Upload to the storage URL you were given instead.')
  if (row.upload) throw new HttpError(409, 'This upload goes in parts. PUT each part to its own URL.')
  if (!req.body) throw new HttpError(400, 'No file was sent.')
  try {
    return Response.json({ received: await store.write(row.originalKey, req.body, Number(row.size)) })
  } catch (e) {
    if (e instanceof Error && e.message === 'UPLOAD_TOO_LARGE') throw new HttpError(413, 'The file is bigger than announced.')
    throw e
  }
}

export async function completeUpload(a: Actor, id: string) {
  const { orgId } = a
  const row = await getAssetRow(id, orgId)
  if (!row) throw new HttpError(404, 'That upload doesn’t exist.')
  if (row.status !== 'uploading') return Response.json({ asset: dtoFor(a, row) })
  if (row.upload) {
    const plan = row.upload
    const size = Number(row.size)
    const stored = await storage().listParts(row.originalKey, plan.uploadId)
    const byNumber = new Map(stored.map((p) => [p.number, p]))
    const missing = Array.from({ length: plan.partCount }, (_, i) => i + 1).filter((n) => byNumber.get(n)?.size !== partLength(size, plan, n))
    if (missing.length) {
      const list = missing.length > 6 ? `${missing.slice(0, 6).join(', ')} and ${missing.length - 6} more` : missing.join(', ')
      throw new HttpError(400, `Part${missing.length > 1 ? 's' : ''} ${list} ${missing.length > 1 ? 'haven’t' : 'hasn’t'} arrived yet. Send ${missing.length > 1 ? 'them' : 'it'}, then complete again.`)
    }
    await storage().multipartComplete(row.originalKey, plan.uploadId, Array.from({ length: plan.partCount }, (_, i) => byNumber.get(i + 1)!))
    await pool.query(`update "asset" set upload = null where id = $1`, [id])
  }
  const stored = await storage().size(row.originalKey)
  if (stored === null) throw new HttpError(400, 'The file never arrived. Try uploading it again.')
  if (stored !== Number(row.size)) throw new HttpError(400, `Only ${stored} of ${row.size} bytes arrived. Try uploading it again.`)
  await assertMinutes(orgId)
  await pool.query(`update "asset" set status = 'queued', stage = 1, progress = 0, "updatedAt" = now() where id = $1`, [id])
  kickWorker()
  return Response.json({ asset: dtoFor(a, (await getAssetRow(id, orgId))!) })
}

/* ------------------------------------------------ playback */
async function media(req: Request, id: string, rel: string) {
  const row = await getAssetRow(id)
  if (!row) return new Response('Not found', { status: 404 })
  let member: boolean | undefined
  const isMember = async () => (member ??= await isMemberOf(req.headers, row.organizationId))
  // a valid playback token travels on to everything the player loads next
  const token = tokenOf(req)
  const passToken = token && (await verifyPlayback(row, token)) ? token : null
  // members see everything; everyone else needs it approved and, for signed assets, a valid token
  const canView = async () => (isPublic(row) && (row.playback !== 'signed' || passToken !== null)) || (await isMember())

  if (rel === 'info') {
    if (!(await canView())) return Response.json({ error: 'Not found' }, { status: 404 })
    // what the public player needs; nothing about the workspace or who uploaded it
    if (row.status === 'uploading') return Response.json({ error: 'Not found' }, { status: 404 })
    const a = toDTO(row)
    const t = (u: string | null) => tokenUrl(u, passToken)
    const info = {
      id: a.id, title: a.title, type: a.type, status: a.status, progress: a.progress, duration: a.duration, width: a.width, height: a.height, renditions: a.renditions,
      thumbUrl: t(a.thumbUrl), posterUrl: t(a.posterUrl), playbackUrl: t(a.playbackUrl),
      playbackUrls: Object.fromEntries(Object.entries(a.playbackUrls).map(([c, u]) => [c, t(u ?? null)])),
      captions: a.captions.filter((c) => c.url).map((c) => ({ lang: c.lang, label: c.label, url: t(c.url) })),
    }
    return Response.json(info, { headers: noStore })
  }
  if (rel === 'transform') return transform(req, id, canView, () => isMember())
  const cc = /^captions\/([a-z]{2,3}(?:-[A-Z]{2})?)\.vtt$/.exec(rel)
  if (cc) {
    const key = await captionKey(row.id, cc[1])
    if (!key || !(await canView())) return new Response('Not found', { status: 404 })
    const res = await storage().serve(key, req)
    res.headers.set('Access-Control-Allow-Origin', '*')
    return res
  }
  if (rel === 'views') {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    if (row.status !== 'ready' || !(await canView())) return new Response('Not found', { status: 404 })
    return recordBeat(req, row)
  }
  if (rel === 'original') {
    if (!(await isMember())) return new Response('Not found', { status: 404 })
    return storage().serve(row.originalKey, req, { download: row.fileName })
  }
  const publicFile = rel === 'thumb.jpg' || rel === 'thumb.png' || rel === 'poster.jpg' || (rel.startsWith('hls/') && row.status === 'ready')
  if (!publicFile || !SAFE_REL.test(rel) || rel.split('/').includes('..')) return new Response('Not found', { status: 404 })
  if (!(await canView())) return new Response('Not found', { status: 404 })
  let res = await storage().serve(`${prefixOf(row)}/${rel}`, req)
  if (passToken && rel.endsWith('.m3u8') && res.ok) {
    // segments and nested playlists are fetched next, without the page's query string: hand them the token
    res = new Response(tokenisePlaylist(await res.text(), passToken), {
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, no-cache' },
    })
  }
  res.headers.set('Access-Control-Allow-Origin', '*') // players on other sites may load the stream
  return res
}

/* ------------------------------------------------ router */
export async function handleMedia(req: Request, pathname: string): Promise<Response | null> {
  const m = req.method
  const parts = pathname.split('/').filter(Boolean) // ['api', 'assets', ...]
  if (parts[0] !== 'api' || !['assets', 'uploads', 'media', 'folders', 'collections', 'tags', 'searches', 'fields', 'moderation', 'keys', 'webhooks', 'v1', 'playback', 'analytics', 'encoding', 'billing'].includes(parts[1])) return null
  if (parts[1] === 'v1') return handleV1(req, parts)
  if (parts[1] === 'playback') return handle(() => handlePlayback(req, parts))
  if (parts[1] === 'encoding' && parts.length === 2) return handle(() => handleEncoding(req))
  if (parts[1] === 'billing' && parts.length <= 4) return handle(() => handleBilling(req, parts))
  if (parts[1] === 'keys' && parts.length <= 3) return handle(() => handleKeys(req, parts[2]))
  if (parts[1] === 'webhooks' && parts.length <= 5) return handle(() => handleWebhooks(req, parts))
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
      if (id && parts.length === 3) return one(await sessionActor(req.headers), req, id)
      if (id && parts[3] === 'retry' && parts.length === 4 && m === 'POST') return retry(await sessionActor(req.headers), id)
      if (id && parts[3] === 'playback-token' && parts.length === 4 && m === 'POST') return playbackToken(await sessionActor(req.headers), req, id)
      if (id && parts[3] === 'captions' && parts.length <= 5) return captions(await sessionActor(req.headers), req, id, parts[4])
    }
    if (parts[1] === 'uploads') {
      if (!id && m === 'POST') return startUpload(await sessionActor(req.headers), req)
      if (id && parts.length === 3 && m === 'PUT') return receiveUpload(await sessionActor(req.headers), req, id)
      if (id && parts[3] === 'complete' && parts.length === 4 && m === 'POST') return completeUpload(await sessionActor(req.headers), id)
      if (id && parts[3] === 'parts' && parts.length === 4 && (m === 'GET' || m === 'POST')) return uploadParts(await sessionActor(req.headers), req, id)
      if (id && parts[3] === 'parts' && parts.length === 5 && m === 'PUT') return receivePart(await sessionActor(req.headers), req, id, Number(parts[4]))
    }
    if (parts[1] === 'media' && id && parts.length > 3 && (m === 'GET' || m === 'HEAD' || (m === 'POST' && parts[3] === 'views'))) return media(req, id, parts.slice(3).join('/'))
    if (parts[1] === 'analytics' && parts.length === 2 && m === 'GET') return analyticsFor((await sessionActor(req.headers)).orgId, req)
    throw new HttpError(404, 'Not found')
  })
}
