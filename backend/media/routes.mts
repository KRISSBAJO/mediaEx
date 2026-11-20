/**
 * MediaEX media API (backend service). Web-standard Request → Response handlers, routed by path:
 *
 *   GET    /api/assets                       the active workspace's assets
 *   GET    /api/assets/:id                   one asset
 *   PATCH  /api/assets/:id                   rename / retag            { title?, tags? }
 *   DELETE /api/assets/:id                   move to Trash (cancel an incomplete upload)
 *   GET    /api/assets/trash                  recoverable assets, for owners and admins
 *   POST   /api/assets/:id/restore            restore during the 30-day recovery window
 *   GET    /api/assets/:id/revisions          version and recovery history
 *   POST   /api/assets/:id/revisions          publish a replacement or restore a saved version
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
import { recovery, trashAssets } from './recovery.mts'
import type { PoolClient } from 'pg'
import { pool } from '../auth.mts'
import { guessType, normaliseTag, parseQuery } from './types.mts'
import { assetPage, searchAssets, workspaceAssetSummary } from './asset-search.mts'
import { MAX_UPLOAD_BYTES, SINGLE_PUT_BYTES, HttpError, apiAsset, getAssetRow, handle, isMemberOf, newAssetId, prefixOf, toDTO, type AssetRow } from './assets.mts'
import { handleKeys, sessionActor, type Actor } from './keys.mts'
import { emitAsset, handleWebhooks } from './webhooks.mts'
import { mergeMetadata, handleFields } from './fields.mts'
import { handleModeration, initialModeration, isPublic } from './moderation.mts'
import { bulk, handleLibrary } from './library.mts'
import { isLocal, storage, storageForWorkspace, type DeliveryAccess } from './storage.mts'
import { transform } from './transform.mts'
import { kickWorker } from './worker.mts'
import { apiBase, handleV1 } from './v1.mts'
import { analyticsFor, recordBeat } from './analytics.mts'
import { handleOperations } from './operations.mts'
import { handleEncoding } from './encoding.mts'
import { captionKey, handleCaptions } from './captions.mts'
import { assertMinutes, assertStorage, handleBilling, planOf } from './billing.mts'
import { checkUploadPolicy, choosePreset, handlePresets, inWorkspaceTransaction } from './presets.mts'
import { PLAYBACK_POLICIES, handlePlayback, playbackLinks, tokenOf, tokenUrl, tokenisePlaylist, ttlFrom, verifiedPlaybackExpiry, type PlaybackPolicy } from './playback.mts'

const SAFE_REL = /^[A-Za-z0-9_-][A-Za-z0-9._/-]*$/
const noStore = { 'Cache-Control': 'no-store' }

async function body<T>(req: Request) {
  return (await req.json().catch(() => null)) as T | null
}

/** Uploads need storage that survives a redeploy. In production, refuse them unless a bucket or a mounted MEDIA_DIR is set. */
function assertDurableStorage(kind: 'local' | 's3') {
  if (process.env.NODE_ENV === 'production' && kind === 'local' && !process.env.MEDIA_DIR) {
    throw new HttpError(503, 'Media storage isn’t configured on the server yet, so uploads are turned off.')
  }
}
export const isDurable = () => storage().kind === 's3' || Boolean(process.env.MEDIA_DIR)

/* ------------------------------------------------ assets */
/** Dashboard callers get app-relative URLs; API-key callers get absolute ones. */
export const dtoFor = (a: Actor, row: AssetRow) => (a.via === 'key' ? apiAsset(row) : toDTO(row))

async function listAll(req: Request) {
  const { orgId } = await sessionActor(req.headers)
  const params = new URL(req.url).searchParams
  const query = parseQuery(params)
  if (params.get('view') === 'page') return Response.json(await assetPage(orgId, query, params), { headers: noStore })
  const [rows, summary] = await Promise.all([
    searchAssets(orgId, query),
    params.get('view') === 'recent' ? workspaceAssetSummary(orgId) : null,
  ])
  return Response.json({ assets: rows.map(toDTO), ...(summary && { summary }) }, { headers: noStore })
}

/** A folder id from a request, checked to belong to the workspace (null = no folder). */
async function folderOf(orgId: string, v: unknown, db: Pick<typeof pool, 'query'> = pool) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || !/^fld_[a-z0-9]{4,24}$/.test(v)) throw new HttpError(404, 'That folder doesn’t exist.')
  const { rows } = await db.query('select id from "folder" where id = $1 and "organizationId" = $2', [v, orgId])
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
    if (b?.playback === 'public' && row.uploadPolicy?.playback === 'signed') throw new HttpError(409, 'This upload preset requires signed playback.')
    const change = await pool.query(`update asset set title=coalesce($2,title), tags=coalesce($3,tags),
      "folderId"=case when $4 then $5 else "folderId" end, metadata=coalesce($6,metadata), playback=coalesce($7,playback),
      "updatedAt"=now() where id=$1 and "deletedAt" is null and "revisionId"=$8`, [
      id, b?.title === undefined ? null : title, b?.tags === undefined ? null : tags, b?.folderId !== undefined, folderId,
      b?.metadata === undefined ? null : JSON.stringify(metadata), b?.playback ?? null, row.revisionId,
    ])
    if (!change.rowCount) throw new HttpError(409, 'The asset changed. Refresh and try again.')
    const updated = await getAssetRow(id, orgId)
    if (!updated) throw new HttpError(404, 'Asset unavailable.')
    return Response.json({ asset: dtoFor(a, updated) })
  }

  if (req.method === 'DELETE') {
    await trashAssets(a, [id])
    return new Response(null, { status: 204 })
  }
  throw new HttpError(405, 'Method not allowed')
}

export async function retry(a: Actor, id: string) {
  const { orgId } = a
  const row = await getAssetRow(id, orgId)
  if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
  if (row.status !== 'ready' && row.status !== 'failed') throw new HttpError(409, 'This asset is still being processed.')
  const client = await pool.connect()
  try {
    await client.query('begin')
    const queued = await client.query(`update asset set status='queued', stage=1, progress=0, error=null, attempts=0, "updatedAt"=now()
      where id=$1 and "revisionId"=$2 and "deletedAt" is null and "takenDown" is null and status in ('ready','failed')
      and not exists(select 1 from workspace_admin w where w."organizationId"=asset."organizationId" and w."suspendedAt" is not null)`, [id,row.revisionId])
    if (!queued.rowCount) throw new HttpError(409, 'The asset changed. Refresh before retrying.')
    await client.query('delete from asset_variant where "assetId"=$1', [id])
    await storage(row).removePrefix(`${prefixOf(row)}/derived`)
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally { client.release() }
  kickWorker()
  return Response.json({ asset: dtoFor(a, (await getAssetRow(id, orgId))!) })
}

/** A signed link for one viewer: works for public and signed assets alike, so callers needn't check first. */
export async function playbackToken(a: Actor, req: Request, id: string) {
  const row = await getAssetRow(id, a.orgId)
  if (row && !isPublic(row)) throw new HttpError(409, 'This asset is unavailable for sharing.')
  if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
  if (row.status !== 'ready') throw new HttpError(409, 'This asset isn’t ready to play yet.')
  const b = await body<{ expiresIn?: unknown }>(req)
  return Response.json(await playbackLinks(row, ttlFrom(b?.expiresIn), a.via === 'key'), { status: 201, headers: noStore })
}

/** caption tracks for an asset in the caller's workspace */
export async function captions(a: Actor, req: Request, id: string, lang?: string) {
  const row = await getAssetRow(id, a.orgId)
  if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
  if (req.method === 'GET') return handleCaptions(req, row, lang, a.via === 'key')
  const client = await pool.connect()
  try {
    await client.query('begin')
    const locked = await client.query('select id from asset where id=$1 and "revisionId"=$2 and "deletedAt" is null for share', [id,row.revisionId])
    if (!locked.rowCount) throw new HttpError(409, 'The asset changed. Refresh before editing captions.')
    const response = await handleCaptions(req, row, lang, a.via === 'key', client)
    await client.query('commit')
    return response
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally { client.release() }
}

/* ------------------------------------------------ uploads */
export async function startUpload(a: Actor, req: Request) {
  const { orgId } = a
  const store = storageForWorkspace(orgId)
  assertDurableStorage(store.kind)
  const b = await body<{ fileName?: unknown; size?: unknown; mimeType?: unknown; folderId?: unknown; presetId?: unknown; multipart?: unknown }>(req)
  const fileName = typeof b?.fileName === 'string' ? b.fileName.trim().slice(0, 255) : ''
  const size = typeof b?.size === 'number' ? b.size : 0
  const mimeType = typeof b?.mimeType === 'string' ? b.mimeType.slice(0, 120) : null
  if (!fileName) throw new HttpError(400, 'The file needs a name.')
  if (!Number.isSafeInteger(size) || size <= 0) throw new HttpError(400, `${fileName} is empty.`)
  if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, `${fileName} is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 ** 3)} GB limit.`)
  const type = guessType(fileName, mimeType)
  if (!type) throw new HttpError(415, `${fileName} isn’t a video, audio or image file MediaEX can process.`)
  const [planId, moderation] = await Promise.all([planOf(orgId), initialModeration(orgId)])
  const id = newAssetId()
  const ext = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1]?.toLowerCase()
  const originalKey = `${orgId}/${id}/original${ext ? `.${ext}` : ''}`
  const title = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || fileName
  const row = await inWorkspaceTransaction(orgId, async client => {
    const preset = await choosePreset(client, orgId, b?.presetId)
    const policy = preset?.policy ?? null
    checkUploadPolicy(policy, type, size)
    const folderId = await folderOf(orgId, preset ? preset.folderId : b?.folderId, client)
    await assertStorage(client, orgId, size, planId)
    const result = await client.query<AssetRow>(
      `insert into asset (id,"organizationId","createdBy","uploadedVia",title,type,status,"fileName","mimeType",size,
        "originalKey","folderId",moderation,playback,"uploadPolicy","uploadExpiresAt","storageBackend")
       values ($1,$2,$3,$4,$5,$6,'uploading',$7,$8,$9,$10,$11,$12,$13,$14,now()+interval '7 days',$15) returning *`,
      [id, orgId, a.userId, a.via === 'key' ? `API key: ${a.keyName}` : null, title, type, fileName, mimeType, size,
       originalKey, folderId, policy ? 'pending' : moderation, policy?.playback ?? 'public', policy, store.kind],
    )
    return result.rows[0]
  })
  let uploadId: string | undefined
  try {
    if (b?.multipart === true || size > SINGLE_PUT_BYTES) {
      const partSize = partSizeFor(size)
      uploadId = await store.multipartStart(originalKey)
      const plan = { uploadId, partSize, partCount: Math.ceil(size / partSize) }
      await pool.query('update asset set upload = $2 where id = $1', [id, JSON.stringify(plan)])
      const base = a.via === 'key' ? `${apiBase()}/api/v1` : '/api'
      return Response.json({ asset: dtoFor(a, row), upload: { kind: 'multipart', partSize, partCount: plan.partCount, parts: `${base}/uploads/${id}/parts` } }, { status: 201 })
    }
    const upload = { kind: 'single', ...(await store.uploadTarget(originalKey, id, size)) }
    if (a.via === 'key' && upload.url.startsWith('/')) upload.url = `${apiBase()}/api/v1/uploads/${id}`
    return Response.json({ asset: dtoFor(a, row), upload }, { status: 201 })
  } catch (error) {
    if (uploadId !== undefined) await store.multipartAbort(originalKey, uploadId)
    await pool.query("delete from asset where id=$1 and status='uploading'", [id])
    throw error
  }
}

async function renewUpload(row: AssetRow) {
  // All provider signing lifetimes fit inside this renewed reservation window.
  await inWorkspaceTransaction(row.organizationId, async db => {
    const result = await db.query(`update asset set "uploadExpiresAt"=clock_timestamp()+interval '7 days'
      where id=$1 and "organizationId"=$2 and status='uploading' and "deletedAt" is null
        and coalesce("uploadExpiresAt", "createdAt"+interval '7 days')>clock_timestamp() returning id`, [row.id, row.organizationId])
    if (!result.rowCount) throw new HttpError(410, 'This upload session has ended. Start a new upload.')
  })
}

// Hold a shared row lock during local part writes, and an exclusive lock while joining or queuing.
// Cleanup and cancellation wait for an in-flight write before removing its storage.
async function withUploadLock<T>(row: AssetRow, shared: boolean, run: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect()
  try {
    await db.query('begin')
    const lock = shared ? 'for share' : 'for update'
    const active = await db.query(`select id from asset where id=$1 and "organizationId"=$2 and "deletedAt" is null
      and status='uploading' and "uploadExpiresAt">now() ${lock}`, [row.id, row.organizationId])
    if (!active.rowCount) throw new HttpError(409, 'This upload session has ended.')
    const result = await run(db)
    await db.query('commit')
    return result
  } catch (error) {
    await db.query('rollback')
    throw error
  } finally { db.release() }
}

const MiB = 1024 ** 2
const partSizeFor = (size: number) => Math.max(16 * MiB, Math.ceil(size / 9000 / MiB) * MiB)
const partLength = (size: number, plan: NonNullable<AssetRow['upload']>, n: number) => (n < plan.partCount ? plan.partSize : size - plan.partSize * (plan.partCount - 1))

async function inParts(a: Actor, id: string) {
  const row = await getAssetRow(id, a.orgId)
  if (!row) throw new HttpError(404, 'That upload doesn’t exist.')
  if (row.status !== 'uploading' || !row.upload) throw new HttpError(409, row.status === 'uploading' ? 'This upload isn’t in parts.' : 'This file has already been uploaded.')
  await renewUpload(row)
  return { row, plan: row.upload }
}

/** GET: what has arrived (to resume) · POST { numbers }: where to send those parts */
export async function uploadParts(a: Actor, req: Request, id: string) {
  const { row, plan } = await inParts(a, id)
  const store = storage(row)
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
      const t = await store.partTarget(row.originalKey, plan.uploadId, n, id, partLength(size, plan, n))
      if (t.url.startsWith('/') && a.via === 'key') t.url = `${apiBase()}/api/v1/uploads/${id}/parts/${n}`
      return { number: n, size: partLength(size, plan, n), ...t }
    }),
  )
  return Response.json({ parts }, { headers: noStore })
}

/** PUT one part (local-disk storage only; buckets take parts directly) */
export async function receivePart(a: Actor, req: Request, id: string, n: number) {
  const { row, plan } = await inParts(a, id)
  const store = storage(row)
  if (!isLocal(store)) throw new HttpError(400, 'Upload parts to the URLs you were given instead.')
  if (!Number.isInteger(n) || n < 1 || n > plan.partCount) throw new HttpError(404, 'That part doesn’t exist.')
  if (!req.body) throw new HttpError(400, 'No data was sent.')
  const expected = partLength(Number(row.size), plan, n)
  try {
    const stream = req.body
    const received = await withUploadLock(row, true, () => store.writePart(row.originalKey, n, stream, expected))
    return Response.json({ number: n, received })
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
  await renewUpload(row)
  const store = storage(row)
  if (!isLocal(store)) throw new HttpError(400, 'Upload to the storage URL you were given instead.')
  if (row.upload) throw new HttpError(409, 'This upload goes in parts. PUT each part to its own URL.')
  if (!req.body) throw new HttpError(400, 'No file was sent.')
  try {
    const stream = req.body
    const received = await withUploadLock(row, false, () => store.write(row.originalKey, stream, Number(row.size)))
    return Response.json({ received })
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
  await assertMinutes(orgId)
  try {
    await renewUpload(row)
    await withUploadLock(row, false, async db => {
      const store = storage(row)
      const size = Number(row.size)
      let stored = await store.size(row.originalKey)
      if (row.upload && stored !== size) {
        const plan = row.upload
        const parts = new Map((await store.listParts(row.originalKey, plan.uploadId)).map(p => [p.number, p]))
        const ordered = Array.from({length: plan.partCount}, (_, i) => parts.get(i + 1))
        if (ordered.some((p, i) => !p || p.size !== partLength(size, plan, i + 1))) throw new HttpError(400, 'Some upload parts are missing or incomplete. Resume the upload and try again.')
        await store.multipartComplete(row.originalKey, plan.uploadId, ordered.map(p => p!))
        stored = await store.size(row.originalKey)
      }
      if (stored === null) throw new HttpError(400, 'The file never arrived. Try uploading it again.')
      if (stored !== size) throw new HttpError(400, `Only ${stored} of ${size} bytes arrived. Try uploading it again.`)
      await db.query(`update asset set status='queued', stage=1, progress=0, upload=null, "uploadExpiresAt"=null, "updatedAt"=now() where id=$1`, [id])
    })
  } catch (error) {
    if (error instanceof HttpError && (error.status === 409 || error.status === 410)) {
      const latest = await getAssetRow(id, orgId)
      if (latest && latest.status !== 'uploading') return Response.json({ asset: dtoFor(a, latest) })
    }
    throw error
  }
  kickWorker()
  return Response.json({ asset: dtoFor(a, (await getAssetRow(id, orgId))!) })
}

/* ------------------------------------------------ playback */
async function media(req: Request, id: string, rel: string) {
  const row = await getAssetRow(id)
  const unavailable = () => new Response('Not found', { status: 404, headers: noStore })
  if (!row) return unavailable()
  let member: boolean | undefined
  const isMember = async () => (member ??= await isMemberOf(req.headers, row.organizationId))
  // a valid playback token travels on to everything the player loads next
  const token = tokenOf(req)
  const expiresAt = await verifiedPlaybackExpiry(row, token)
  const passToken = expiresAt === null ? null : token
  let access: DeliveryAccess = 'member'
  if (isPublic(row) && (!row.uploadPolicy || row.status === 'ready')) {
    if (expiresAt !== null) access = { expiresAt }
    else if (row.playback !== 'signed') access = 'public'
  }
  const canView = async () => access !== 'member' || (await isMember())

  if (rel === 'info') {
    if (!(await canView())) return Response.json({ error: 'Not found' }, { status: 404, headers: noStore })
    // what the public player needs; nothing about the workspace or who uploaded it
    if (row.status === 'uploading') return Response.json({ error: 'Not found' }, { status: 404, headers: noStore })
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
  if (rel === 'transform') {
    if (!(await canView())) return new Response(null, { status: 404, headers: noStore })
    return transform(req, row, access, isMember)
  }
  const cc = /^captions\/([a-z]{2,3}(?:-[A-Z]{2})?)\.vtt$/.exec(rel)
  if (cc) {
    const key = await captionKey(row.id, cc[1])
    if (!key || !(await canView())) return unavailable()
    const res = await storage(row).serve(key, req, { access })
    res.headers.set('Access-Control-Allow-Origin', '*')
    return res
  }
  if (rel === 'views') {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    if (row.status !== 'ready' || !(await canView())) return unavailable()
    return recordBeat(req, row)
  }
  if (rel === 'original') {
    if (!(await isMember())) return unavailable()
    return storage(row).serve(row.originalKey, req, { access: 'member', download: row.fileName })
  }
  const publicFile = rel === 'thumb.jpg' || rel === 'thumb.png' || rel === 'poster.jpg' || (rel.startsWith('hls/') && row.status === 'ready')
  if (!publicFile || !SAFE_REL.test(rel) || rel.split('/').includes('..')) return unavailable()
  if (!(await canView())) return unavailable()
  let res = await storage(row).serve(`${prefixOf(row)}/${rel}`, req, { access })
  if (passToken && typeof access === 'object' && req.method !== 'HEAD' && rel.endsWith('.m3u8') && res.ok) {
    // segments and nested playlists are fetched next, without the page's query string: hand them the token
    res = new Response(tokenisePlaylist(await res.text(), passToken), {
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, no-store' },
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
  if (parts[1] === 'uploads' && parts[2] === 'presets' && parts.length <= 4) return handle(() => handlePresets(req, parts[3]))
  if (parts[1] === 'playback') return handle(() => handlePlayback(req, parts))
  if (parts[1] === 'encoding' && parts.length === 2) return handle(() => handleEncoding(req))
  if (parts[1] === 'analytics' && parts[2] === 'operations' && parts.length === 3) return handle(() => handleOperations(req))
  if (parts[1] === 'billing' && parts.length <= 4) return handle(() => handleBilling(req, parts))
  if (parts[1] === 'keys' && parts.length <= 3) return handle(() => handleKeys(req, parts[2]))
  if (parts[1] === 'webhooks' && parts.length <= 5) return handle(() => handleWebhooks(req, parts))
  if (parts[1] === 'fields' && parts.length <= 3) return handle(() => handleFields(req, parts[2]))
  if (['folders', 'collections', 'tags', 'searches'].includes(parts[1])) return handle(() => handleLibrary(req, parts))
  if (parts[1] === 'moderation' && parts.length === 3) return handle(() => handleModeration(req, parts[2]))
  if (parts[1] === 'assets' && parts[2] === 'trash' && parts.length === 3) return handle(async () => recovery(await sessionActor(req.headers), req, undefined, 'trash'))
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
      if (id && parts.length === 4 && ['restore','revisions'].includes(parts[3])) return recovery(await sessionActor(req.headers), req, id, parts[3])
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
