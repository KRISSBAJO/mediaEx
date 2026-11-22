import type { PoolClient } from 'pg'
import { pool } from '../auth.mts'
import { HttpError, prefixOf, type AssetRow } from './assets.mts'
import { type Actor } from './keys.mts'
import { checkProbedPolicy } from './presets.mts'
import { storage } from './storage.mts'
import { emitAsset } from './webhooks.mts'

const noStore = { 'Cache-Control': 'private, no-store' }
const respond = (data: unknown) => Response.json(data, { headers: noStore })
const missing = () => new HttpError(404, 'This asset is unavailable in the selected workspace.')
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
type VersionRow = AssetRow & { deletedAt: string | null; revisionId: string }
type Snapshot = {
  asset: VersionRow
  captions: Array<Record<string, unknown>>
  variants: Array<{ bytes: number } & Record<string, unknown>>
  collections: string[]
}

function requireManager(a: Actor) {
  if (a.via === 'key' ? a.scope !== 'full' : !['owner', 'admin'].includes(a.role))
    throw new HttpError(403, 'An owner, admin or full-access API key is required for recovery.')
}

async function transaction<T>(fn: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect()
  try {
    await db.query('begin')
    const result = await fn(db)
    await db.query('commit')
    return result
  } catch (error) {
    await db.query('rollback')
    throw error
  } finally {
    db.release()
  }
}

async function audit(db: PoolClient, a: Actor, id: string, action: string, version: string) {
  const actor = a.label ?? (a.via === 'key' ? 'key:' + (a.keyId ?? a.keyName) : 'user:' + a.userId)
  await db.query('insert into asset_recovery_event ("organizationId","assetId",action,actor,"revisionId") values ($1,$2,$3,$4,$5)',
    [a.orgId, id, action, actor, version])
}

async function requireBytes(row: AssetRow, captions: Snapshot['captions'] = []) {
  const store = storage(row)
  if (Number(row.size) !== await store.size(row.originalKey))
    throw new HttpError(409, 'The stored original is missing or incomplete. The asset has been left in place.')
  const outputs = new Set([row.thumbKey, row.posterKey, row.playlistKey, ...Object.values(row.playlists ?? {}),
    ...captions.filter(c => c.status === 'ready').map(c => c.key)].filter((key): key is string => typeof key === 'string'))
  const prefix = prefixOf(row) + '/'
  for (const key of outputs) {
    if (!key.startsWith(prefix) || (await store.size(key) ?? 0) <= 0)
      throw new HttpError(409, 'A saved output or caption is unavailable. The asset has been left in place.')
  }
}

/** A row remains in its workspace throughout the recovery window, including its captions and collections. */
export async function trashAssets(a: Actor, ids: string[]) {
  const removed = await transaction(async db => {
    const { rows } = await db.query<VersionRow>(
      'select * from asset where "organizationId"=$1 and id=any($2::text[]) and "deletedAt" is null order by id for update', [a.orgId, ids])
    if (rows.some(row => row.status === 'processing')) throw new HttpError(409, 'Wait for encoding to finish before moving the asset to Trash.')
    const working = await db.query(`select 1 from caption where "assetId"=any($1::text[]) and status='processing' limit 1`, [rows.map(row => row.id)])
    if (working.rowCount) throw new HttpError(409, 'Wait for caption processing to finish before moving the asset to Trash.')
    for (const row of rows) {
      // Commit cancellation first. The expiry worker can retry interrupted storage cleanup.
      if (row.status === 'uploading') {
        await db.query(`update asset set "deletedAt"=now()-interval '30 days', "updatedAt"=now() where id=$1`, [row.id])
        await audit(db, a, row.id, 'upload.cancelled', row.revisionId)
      } else {
        await db.query('update asset set "deletedAt"=now(), "updatedAt"=now() where id=$1', [row.id])
        await audit(db, a, row.id, 'trashed', row.revisionId)
      }
    }
    return rows
  })
  for (const row of removed) await emitAsset(row, 'asset.deleted')
  return removed.length
}

async function getSnapshot(db: PoolClient, row: VersionRow): Promise<Snapshot> {
  const { rows: [related] } = await db.query(
    `select coalesce((select jsonb_agg(to_jsonb(c)) from caption c where c."assetId"=$1),'[]') as captions,
       coalesce((select jsonb_agg(to_jsonb(v)) from asset_variant v where v."assetId"=$1),'[]') as variants,
       coalesce((select jsonb_agg(c."collectionId") from collection_asset c where c."assetId"=$1),'[]') as collections`, [row.id])
  if (related.captions.some((c: { status: string }) => c.status === 'queued' || c.status === 'processing'))
    throw new HttpError(409, 'Wait for caption processing to finish before switching versions.')
  return { asset: row, captions: related.captions, variants: related.variants, collections: related.collections }
}

async function archive(db: PoolClient, previous: Snapshot) {
  const a = previous.asset
  const derived = Number(a.outputSize) + previous.variants.reduce((n, v) => n + Number(v.bytes), 0)
  await db.query('insert into asset_revision (id,"organizationId","assetId",snapshot,size,"outputSize") values ($1,$2,$3,$4,$5,$6)',
    [a.revisionId, a.organizationId, a.id, JSON.stringify(previous), a.size, derived])
}

// A completed upload already has immutable, isolated files. Reassign their references in the same transaction
// as the prior version snapshot. No copying, overwriting or renaming large files is needed.
async function activate(db: PoolClient, current: VersionRow, snapshot: Snapshot, restoreMetadata: boolean) {
  const next = { ...snapshot.asset }
  const fields = ['revisionId','originalKey','storageBackend','size','outputSize','duration','width','height','fileName','mimeType','sourceInfo',
    'renditions','thumbKey','posterKey','playlistKey','playlists','readyAt','moderation','moderationFlags','moderationNote','moderatedBy','moderatedAt','playback',
    'uploadPolicy']
  // The replacement must fit both ingestion policies, including the original output ladder.
  const policy = current.uploadPolicy
  if (policy) {
    checkProbedPolicy(policy, next, Number(next.size))
    if (next.type === 'video' && policy.maxShortSide && next.renditions.some(r =>
      r.width && r.height && /^\d+p/.test(r.name) && Math.min(r.width,r.height) > policy.maxShortSide!))
      throw new HttpError(409, 'Encode the replacement with the original preset output limit first.')
    const incoming = next.uploadPolicy
    const strictest = (left: number | null, right: number | null) => left === null ? right : right === null ? left : Math.min(left,right)
    next.uploadPolicy = incoming ? {
      kinds: policy.kinds.filter(kind => incoming.kinds.includes(kind)),
      maxBytes: strictest(policy.maxBytes,incoming.maxBytes),
      maxSourceEdge: strictest(policy.maxSourceEdge,incoming.maxSourceEdge),
      maxShortSide: strictest(policy.maxShortSide,incoming.maxShortSide),
      maxDuration: strictest(policy.maxDuration,incoming.maxDuration),
      review: policy.review || incoming.review,
      playback: policy.playback === 'signed' ? 'signed' : incoming.playback,
    } : policy
    if (next.uploadPolicy.review && next.moderation === 'approved' && !next.moderatedBy) next.moderation = 'pending'
    if (next.uploadPolicy.playback === 'signed') next.playback = 'signed'
  }
  // Keep signed delivery and outstanding moderation decisions on the logical asset.
  if (current.playback === 'signed') next.playback = 'signed'
  if (current.moderation === 'rejected' || (current.moderation === 'pending' && next.moderation === 'approved')) {
    next.moderation = current.moderation
    next.moderationFlags = current.moderationFlags
    next.moderationNote = current.moderationNote
    next.moderatedAt = current.moderatedAt
    next.moderatedBy = current.moderatedBy
  }
  if (restoreMetadata) {
    fields.push('title','tags','metadata','folderId')
    if (next.folderId && !(await db.query('select 1 from folder where id=$1 and "organizationId"=$2', [next.folderId,current.organizationId])).rowCount) next.folderId = null
  }
  if (next.moderatedBy && !(await db.query('select 1 from "user" where id=$1', [next.moderatedBy])).rowCount) next.moderatedBy = null
  const columns = fields.filter(k => Object.hasOwn(current, k) && Object.hasOwn(next, k)).map(k => '"' + k + '"')
  await db.query(`update asset set ${columns.map(k => k+'=v.'+k).join(',')}, "updatedAt"=now()
    from jsonb_populate_record(null::asset,$2::jsonb) v where asset.id=$1`, [current.id, JSON.stringify(next)])
  await db.query('delete from caption where "assetId"=$1', [current.id])
  await db.query('delete from asset_variant where "assetId"=$1', [current.id])
  for (const [table, records] of [['caption', snapshot.captions], ['asset_variant', snapshot.variants]] as const) {
    if (records.length) await db.query(`insert into ${table} select * from jsonb_populate_recordset(null::${table}, $1::jsonb)`,
      [JSON.stringify(records.map(c => ({ ...c, assetId: current.id })))])
  }
  if (restoreMetadata) {
    await db.query('delete from collection_asset where "assetId"=$1', [current.id])
    await db.query('insert into collection_asset ("assetId","collectionId") select $1,id from collection where "organizationId"=$2 and id=any($3::text[])',
      [current.id,current.organizationId,snapshot.collections])
  }
}

export async function recovery(a: Actor, req: Request, id: string | undefined, action: string) {
  requireManager(a)
  if (!id && action === 'trash' && req.method === 'GET') {
    const { rows } = await pool.query(`select id,title,"fileName","deletedAt","deletedAt"+interval '30 days' as "expiresAt"
      from asset where "organizationId"=$1 and "deletedAt">now()-interval '30 days' order by "deletedAt" desc,id`, [a.orgId])
    return respond({ assets: rows })
  }
  if (!id) throw missing()
  if (action === 'restore' && req.method === 'POST') {
    await transaction(async db => {
      const { rows: [row] } = await db.query<VersionRow>('select * from asset where id=$1 and "organizationId"=$2 for update', [id,a.orgId])
      if (!row) throw missing()
      if (!row.deletedAt) return
      if (!(await db.query(`select 1 from asset where id=$1 and "deletedAt">now()-interval '30 days'`,[id])).rowCount)
        throw new HttpError(410, 'The 30-day restore window has ended.')
      const tracks = await db.query('select status,key from caption where "assetId"=$1', [id])
      await requireBytes(row, tracks.rows)
      await db.query('update asset set "deletedAt"=null, "updatedAt"=now() where id=$1', [id])
      await audit(db,a,id,'restored',row.revisionId)
    })
    return respond({ restored: true })
  }
  if (action !== 'revisions') throw missing()
  if (req.method === 'GET') {
    const { rows: [row] } = await pool.query('select "revisionId" from asset where id=$1 and "organizationId"=$2 and "deletedAt" is null',[id,a.orgId])
    if (!row) throw missing()
    const { rows } = await pool.query(`select id, snapshot->'asset'->>'fileName' as "fileName",size,"createdAt"
      from asset_revision where "assetId"=$1 and "organizationId"=$2 order by "createdAt" desc,id`, [id,a.orgId])
    const history = await pool.query('select action,actor,"createdAt" from asset_recovery_event where "assetId"=$1 and "organizationId"=$2 order by id desc limit 50',[id,a.orgId])
    return respond({ current: row.revisionId, versions: rows, history: history.rows })
  }
  if (req.method !== 'POST') throw new HttpError(405,'Method not allowed.')
  const input = await req.json().catch(() => null)
  const sourceId = input?.replacementId
  const revision = input?.restoreRevisionId
  if (!UUID.test(input?.expectedCurrent ?? '') || Boolean(sourceId) === Boolean(revision) ||
    (sourceId && (typeof sourceId !== 'string' || !/^ast_[a-z0-9]{6,20}$/.test(sourceId) || sourceId === id)) ||
    (revision && (typeof revision !== 'string' || !UUID.test(revision)))) throw new HttpError(400,'Choose a valid asset version.')
  await transaction(async db => {
    const { rows } = await db.query<VersionRow>(`select * from asset where "organizationId"=$1 and id=any($2::text[]) and "deletedAt" is null order by id for update`,
      [a.orgId, sourceId ? [id, sourceId] : [id]])
    const current = rows.find(x => x.id === id)
    if (!current) throw missing()
    if (current.takenDown) throw new HttpError(409, 'This asset is under a site-admin takedown.')
    if (current.revisionId === revision) return
    if (current.revisionId !== input.expectedCurrent) throw new HttpError(409,'The current version changed. Refresh and try again.')
    if (current.status !== 'ready') throw new HttpError(409,'The current asset must finish processing first.')
    let next: Snapshot
    if (sourceId) {
      const source = rows.find(x => x.id === sourceId)
      if (!source) throw missing()
      if (source.type !== current.type || source.status !== 'ready') throw new HttpError(409,'Choose a ready upload of the same media type.')
      if ((await db.query('select 1 from asset_revision where "assetId"=$1 limit 1',[sourceId])).rowCount)
        throw new HttpError(409,'The replacement has version history. Choose a fresh upload.')
      next = await getSnapshot(db,source)
    } else {
      const { rows: [version] } = await db.query('select snapshot from asset_revision where id=$1 and "assetId"=$2 and "organizationId"=$3 for update',[revision,id,a.orgId])
      if (!version) throw missing()
      next = version.snapshot
    }
    if (next.asset.takenDown) throw new HttpError(409, 'The selected version is under a site-admin takedown.')
    const previous = await getSnapshot(db,current)
    await requireBytes(current,previous.captions)
    await requireBytes(next.asset,next.captions)
    await archive(db,previous)
    await activate(db,current,next,Boolean(revision))
    if (sourceId) {
      await db.query('update media_store_transfer set "assetId"=$1 where "assetId"=$2 and "organizationId"=$3', [id,sourceId,a.orgId])
      await db.query('update view_session set "assetId"=$1 where "assetId"=$2', [id,sourceId])
      await db.query('delete from asset where id=$1', [sourceId])
      await audit(db,a,sourceId,'used as replacement',next.asset.revisionId)
    } else {
      await db.query('delete from asset_revision where id=$1',[revision])
    }
    await audit(db,a,id,sourceId ? 'version published' : 'version restored',next.asset.revisionId)
  })
  return respond({ updated: true })
}

// Validate all physical prefixes and receipts before removing any files. Recoverable
// partial failures keep both the logical asset and every receipt for a later retry.
type StoredVersion = Pick<VersionRow, 'id' | 'organizationId' | 'revisionId' | 'originalKey' | 'storageBackend' | 'upload'>
type Receipt = { revisionId: string; prefix: string; organizationId: string }
type PermanentJob = { assetId: string; organizationId: string; versions: StoredVersion[]; receipts: Receipt[] }

async function removeCopies(db: PoolClient, row: { id: string; organizationId: string }, versions: StoredVersion[], receipts: Receipt[]) {
  const copies = new Map(receipts.map(receipt => [receipt.revisionId,receipt]))
  const plan = []
  for (const version of versions) {
    const prefix = prefixOf(version)
    const [organization, physicalId, extra] = prefix.split('/')
    if (version.organizationId !== row.organizationId || organization !== row.organizationId || extra !== undefined || !/^ast_[a-z0-9]{6,20}$/.test(physicalId || ''))
      throw new Error('Invalid retained asset storage prefix.')
    const shared = await db.query(`select 1 from asset where "organizationId"=$1 and id<>$2 and starts_with("originalKey",$3)
      union all select 1 from asset_revision where "organizationId"=$1 and "assetId"<>$2 and starts_with(snapshot->'asset'->>'originalKey',$3)
      union all select 1 from media_store_transfer where "organizationId"=$1 and "assetId"<>$2 and prefix=$4
      union all select 1 from media_permanent_cleanup j where j."organizationId"=$1 and j."assetId"<>$2 and
        (exists(select 1 from jsonb_array_elements(j.versions) v where starts_with(v->>'originalKey',$3))
         or exists(select 1 from jsonb_array_elements(j.receipts) t where t->>'prefix'=$4)) limit 1`,
      [row.organizationId,row.id,prefix+'/',prefix])
    if (shared.rowCount) throw new Error('Another asset references a retained storage prefix.')
    plan.push({ prefix, version, store: storage(version) })
    const receipt = copies.get(version.revisionId)
    if (receipt) {
      if (receipt.prefix !== prefix || receipt.organizationId !== row.organizationId) throw new Error('Transfer receipt differs from the stored version.')
      copies.delete(version.revisionId)
      const counterpart = version.storageBackend === 'local' ? 's3' : 'local'
      plan.push({ prefix, version, store: storage({ storageBackend: counterpart, organizationId: version.organizationId }) })
    }
  }
  if (copies.size) throw new Error('Transfer receipt has no matching retained version.')
  for (const { prefix, version, store } of plan) {
    if (version.upload) await store.multipartAbort(version.originalKey, version.upload.uploadId)
    await store.removePrefix(prefix)
  }
}

async function purgeOne(db: PoolClient, row: VersionRow) {
  const saved = await db.query<{ snapshot: Snapshot }>('select snapshot from asset_revision where "assetId"=$1',[row.id])
  const receipts = await db.query<Receipt>('select "revisionId",prefix,"organizationId" from media_store_transfer where "assetId"=$1 for update',[row.id])
  await removeCopies(db,row,[row,...saved.rows.map(item => item.snapshot.asset)],receipts.rows)
  await db.query('delete from asset where id=$1',[row.id])
  await db.query('insert into asset_recovery_event ("assetId","organizationId",action,actor,"revisionId") values ($1,$2,$3,$4,$5)',
    [row.id,row.organizationId,'expired','system',row.revisionId])
}

/** Explicit permanent deletions bypass the optional Trash-expiry policy. */
export async function cleanPermanentDeletions(orgId?: string) {
  for (let i=0;i<10;i++) {
    const found = await transaction(async db => {
      const { rows: [job] } = await db.query<PermanentJob>(`select * from media_permanent_cleanup
        where "nextAttemptAt"<=now() and ($1::text is null or "organizationId"=$1)
        order by "nextAttemptAt","assetId" limit 1 for update skip locked`, [orgId ?? null])
      if (!job) return false
      if (!job.versions.length) throw new Error('Permanent deletion has no versions.')
      try {
        if ((await db.query('select 1 from asset where id=$1',[job.assetId])).rowCount) throw new Error('The asset ID is still active.')
        await removeCopies(db,{ id:job.assetId,organizationId:job.organizationId },job.versions,job.receipts)
      } catch (error) {
        // If a query failed, use a fresh transaction next time. A failed storage
        // call leaves every physical reference in this job for an idempotent retry.
        await db.query(`update media_permanent_cleanup set attempts=attempts+1, "lastError"='Storage cleanup could not finish.',
          "nextAttemptAt"=now()+interval '15 minutes' where "assetId"=$1`,[job.assetId])
        console.warn('[media maintenance] Permanent deletion will retry for asset',job.assetId)
        return true
      }
      await db.query('delete from media_permanent_cleanup where "assetId"=$1',[job.assetId])
      return true
    })
    if (!found) return
  }
}

export async function purgeExpiredTrash(orgId?: string) {
  const failures: unknown[] = []
  for (let i = 0; i < 10; i++) {
    let selected: string | undefined
    try {
      const found = await transaction(async db => {
        const { rows: [row] } = await db.query<VersionRow>(`select * from asset where "deletedAt"<=now()-interval '30 days'
          and ("trashRetryAt" is null or "trashRetryAt" <= now())
          and ($1::text is null or "organizationId"=$1) order by "deletedAt",id for update skip locked limit 1`, [orgId ?? null])
        if (!row) return false
        selected = row.id
        await purgeOne(db,row)
        return true
      })
      if (!found) break
    } catch (error) {
      if (!selected) throw error
      failures.push(error)
      await pool.query(`update asset set "trashRetryAt"=now()+interval '15 minutes' where id=$1 and "deletedAt"<=now()-interval '30 days'`, [selected])
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Some expired assets could not be purged. Their cleanup will retry.')
}
