/**
 * Backup copies: a second copy of every original file, kept in a separate store, for workspaces that turn it on
 * (Settings → Backups, Pro and Studio). Only originals are copied: every encoded file can be rebuilt from them.
 *
 * The operator configures the backup store once for the server, separate from the media store:
 *   BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
 *     a second S3-compatible bucket, ideally another provider or region; or
 *   BACKUP_DIR   a second disk (single-server installs)
 *   BACKUP_LABEL how the dashboard names the location, e.g. "Backblaze B2 · EU Central"
 *
 *   GET  /api/assets/backup                 the workspace's setting and progress           members
 *   PUT  /api/assets/backup                 { enabled }                                    owners and admins
 *   GET  /api/assets/:id/backup             this asset's copy                              members
 *   POST /api/assets/:id/backup/restore     put the original back from the copy            owners and admins
 *
 * Copies are keyed by the original's storage key, and live under the same `<workspace>/<asset>/` prefix as the media
 * store, so permanent deletion (removeCopies in recovery.mts) removes them with the rest of the asset. Turning
 * backups off removes the workspace's copies within minutes.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { PoolClient } from 'pg'
import { pool } from '../auth.mts'
import { HttpError, requireMember, type AssetRow } from './assets.mts'
import { PLANS, planOf } from './billing.mts'
import { backupStore, storage, type Storage } from './storage.mts'
import type { AssetBackup, BackupSettings, BackupStats } from './types.mts'

const headers = { 'Cache-Control': 'private, no-store' }
const LEASE = "interval '1 hour'"
const BATCH = 4
type Database = Pick<PoolClient, 'query'>

/** Copy one stored file between stores and check the size that arrived. */
async function transfer(from: Storage, to: Storage, key: string, bytes: number) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'mx-backup-'))
  try {
    const file = await from.localCopy(key, scratch)
    await to.putFile(key, file)
    const arrived = await to.size(key)
    if (arrived !== bytes) throw new Error(`The copy is ${arrived ?? 0} bytes, expected ${bytes}.`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

type Candidate = Pick<AssetRow, 'id' | 'organizationId' | 'originalKey' | 'size' | 'storageBackend'>

/** Claim a key by inserting or re-leasing its record; returns false when another instance holds it. */
async function claim(a: Candidate) {
  const { rowCount } = await pool.query(`
    insert into media_backup (key, "organizationId", "assetId", bytes, status, "nextAttemptAt") values ($1, $2, $3, $4, 'copying', now() + ${LEASE})
    on conflict (key) do update set status = 'copying', "nextAttemptAt" = now() + ${LEASE}, attempts = media_backup.attempts + 1, bytes = excluded.bytes
      where media_backup.status in ('copying', 'failed') and media_backup."nextAttemptAt" <= now()`,
    [a.originalKey, a.organizationId, a.id, a.size])
  return rowCount === 1
}

async function copyOne(store: Storage, a: Candidate) {
  if (!(await claim(a))) return
  try {
    await transfer(storage(a), store, a.originalKey, Number(a.size))
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    // back off: 5 min, 20 min, 80 min … up to a day
    await pool.query(`update media_backup set status = 'failed', "lastError" = $2,
      "nextAttemptAt" = now() + least(interval '1 day', interval '5 minutes' * power(4, least(attempts, 6))) where key = $1 and status = 'copying'`, [a.originalKey, message])
    console.warn('[media backup] A copy failed and will retry:', a.id, message)
    return
  }
  // Permanent deletion may have run while the file was copying: only keep a copy that an asset still points at.
  const { rowCount } = await pool.query(`update media_backup set status = 'copied', "copiedAt" = now(), "lastError" = null
    where key = $1 and status = 'copying' and exists (select 1 from asset where "originalKey" = $1)`, [a.originalKey])
  if (!rowCount && !(await pool.query(`select 1 from asset where "originalKey" = $1`, [a.originalKey])).rowCount) {
    await store.remove(a.originalKey)
    await pool.query(`delete from media_backup where key = $1`, [a.originalKey])
  }
}

/** Remove the copies of workspaces that turned backups off. */
async function removeDisabled(store: Storage) {
  const { rows } = await pool.query<{ key: string }>(`
    update media_backup set "nextAttemptAt" = now() + ${LEASE} where key in (
      select key from media_backup where status = 'removing' and "nextAttemptAt" <= now() order by "nextAttemptAt" limit 50 for update skip locked)
    returning key`)
  for (const { key } of rows) {
    try {
      await store.remove(key)
      await pool.query(`delete from media_backup where key = $1 and status = 'removing'`, [key])
    } catch {
      await pool.query(`update media_backup set "nextAttemptAt" = now() + interval '15 minutes' where key = $1`, [key])
    }
  }
}

/** One pass: new and failed copies for workspaces with backups on (and a plan that includes them), then removals. */
export async function runBackups() {
  const store = backupStore()
  if (!store) return 0
  await removeDisabled(store)
  const { rows } = await pool.query<Candidate>(`
    select a.id, a."organizationId", a."originalKey", a.size, a."storageBackend" from asset a
    join workspace_setting w on w."organizationId" = a."organizationId" and w."backupEnabled"
    left join media_backup b on b.key = a."originalKey"
    where a.status in ('ready', 'failed') and a."deletedAt" is null and a.size > 0
      and (b.key is null or (b.status in ('copying', 'failed') and b."nextAttemptAt" <= now()))
    order by b."nextAttemptAt" nulls first, a."createdAt" limit 50`)
  const plans = new Map<string, boolean>()
  let attempted = 0
  for (const a of rows) {
    if (!plans.has(a.organizationId)) plans.set(a.organizationId, PLANS[await planOf(a.organizationId)].backups)
    if (!plans.get(a.organizationId)) continue
    await copyOne(store, a)
    if (++attempted >= BATCH) break
  }
  return attempted
}

let kick: (() => void) | null = null

export function startBackups() {
  if (!backupStore()) return
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      // keep going while there is a backlog, a few copies at a time
      for (let i = 0; i < 25 && (await runBackups()) > 0; i++);
    } catch (e) {
      console.warn('[media backup] Backup pass failed; it will retry.', e instanceof Error ? e.message : e)
    } finally {
      running = false
    }
  }
  kick = () => void run()
  void run()
  setInterval(() => void run(), 60_000).unref()
  console.log('[media backup] backup copier started')
}

/**
 * Called by permanent deletion for each removed storage prefix, inside its transaction. Throws (so deletion retries
 * later) when copies exist but the backup store is unreachable or no longer configured.
 */
export async function removeBackupCopies(db: Database, organizationId: string, prefix: string) {
  const { rows } = await db.query<{ key: string }>(`select key from media_backup where "organizationId" = $1 and starts_with(key, $2)`, [organizationId, prefix + '/'])
  if (!rows.length) return
  const store = backupStore()
  if (!store) throw new Error('Backup copies exist but no backup store is configured.')
  // the whole prefix, so a partial copy from an interrupted run goes too
  await store.removePrefix(prefix)
  await db.query(`delete from media_backup where "organizationId" = $1 and starts_with(key, $2)`, [organizationId, prefix + '/'])
}

async function stats(orgId: string, db: Database = pool): Promise<BackupStats> {
  const { rows: [s] } = await db.query<BackupStats>(`
    select count(*)::int as originals,
      count(*) filter (where b.status = 'copied')::int as copied,
      count(*) filter (where b.key is null or b.status = 'copying')::int as waiting,
      count(*) filter (where b.status = 'failed')::int as failed,
      (select count(*)::int from media_backup where "organizationId" = $1 and status = 'removing') as removing,
      (select coalesce(sum(bytes), 0)::float8 from media_backup where "organizationId" = $1 and status = 'copied') as bytes,
      (select max("copiedAt") from media_backup where "organizationId" = $1) as "lastCopiedAt"
    from asset a left join media_backup b on b.key = a."originalKey"
    where a."organizationId" = $1 and a.status in ('ready', 'failed') and a."deletedAt" is null and a.size > 0`, [orgId])
  return s
}

async function settings(orgId: string): Promise<BackupSettings> {
  const [{ rows: [w] }, plan, s] = await Promise.all([
    pool.query<{ backupEnabled: boolean; backupChangedAt: string | null }>(`select "backupEnabled", "backupChangedAt" from workspace_setting where "organizationId" = $1`, [orgId]),
    planOf(orgId),
    stats(orgId),
  ])
  const available = backupStore() !== null
  return {
    available, location: available ? process.env.BACKUP_LABEL?.trim() || 'A separate storage location' : null,
    planIncludes: PLANS[plan].backups, enabled: w?.backupEnabled ?? false, changedAt: w?.backupChangedAt ?? null, stats: s,
  }
}

export async function handleBackup(req: Request) {
  const { orgId, role } = await requireMember(req.headers)
  if (req.method === 'GET') return Response.json(await settings(orgId), { headers })
  if (req.method !== 'PUT') throw new HttpError(405, 'Use GET or PUT.')
  if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Only workspace owners and admins can change backups.')
  const body = await req.json().catch(() => null) as { enabled?: unknown } | null
  if (typeof body?.enabled !== 'boolean') throw new HttpError(400, 'Specify enabled: true or false.')
  if (body.enabled) {
    if (!backupStore()) throw new HttpError(409, 'Backups are not available on this server yet.')
    if (!PLANS[await planOf(orgId)].backups) throw new HttpError(402, 'Backup copies come with Pro and Studio. Upgrade to turn them on.')
  }
  const db = await pool.connect()
  try {
    await db.query('begin')
    await db.query(`insert into workspace_setting ("organizationId", "backupEnabled", "backupChangedAt", "updatedAt") values ($1, $2, now(), now())
      on conflict ("organizationId") do update set "backupEnabled" = $2, "backupChangedAt" = now(), "updatedAt" = now()
      where workspace_setting."backupEnabled" is distinct from $2`, [orgId, body.enabled])
    // Off: every copy is queued for removal. On again: copies still waiting to be removed are refreshed instead.
    if (body.enabled) await db.query(`update media_backup set status = 'failed', "nextAttemptAt" = now(), attempts = 0 where "organizationId" = $1 and status = 'removing'`, [orgId])
    else await db.query(`update media_backup set status = 'removing', "nextAttemptAt" = now() where "organizationId" = $1 and status <> 'removing'`, [orgId])
    await db.query('commit')
  } catch (e) {
    await db.query('rollback')
    throw e
  } finally {
    db.release()
  }
  kick?.()
  return Response.json(await settings(orgId), { headers })
}

export async function handleAssetBackup(req: Request, id: string, action: string | undefined) {
  const { orgId, role, user } = await requireMember(req.headers)
  const { rows: [a] } = await pool.query<AssetRow>(`select * from asset where id = $1 and "organizationId" = $2`, [id, orgId])
  if (!a) throw new HttpError(404, 'This asset is unavailable in the selected workspace.')
  const { rows: [b] } = await pool.query<{ status: AssetBackup['status']; copiedAt: string | null; bytes: string; lastError: string | null }>(
    `select status, "copiedAt", bytes, "lastError" from media_backup where key = $1`, [a.originalKey])
  if (!action && req.method === 'GET') {
    const view: AssetBackup = b ? { status: b.status, copiedAt: b.copiedAt, bytes: Number(b.bytes), error: b.status === 'failed' ? b.lastError : null } : { status: 'none', copiedAt: null, bytes: null, error: null }
    return Response.json(view, { headers })
  }
  if (action !== 'restore' || req.method !== 'POST') throw new HttpError(405, 'Unsupported backup operation.')
  if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Only workspace owners and admins can restore from a backup.')
  const store = backupStore()
  if (!store || b?.status !== 'copied') throw new HttpError(409, 'This asset has no backup copy to restore from.')
  const media = storage(a)
  if (await media.size(a.originalKey) === Number(a.size)) throw new HttpError(409, 'The original is intact, so there is nothing to restore.')
  try {
    await transfer(store, media, a.originalKey, Number(a.size))
  } catch (e) {
    console.warn('[media backup] Restore failed:', id, e instanceof Error ? e.message : e)
    throw new HttpError(502, 'The backup copy could not be restored. Try again in a few minutes.')
  }
  await pool.query(`insert into asset_recovery_event ("organizationId", "assetId", action, actor, "revisionId") values ($1, $2, $3, $4, $5)`,
    [orgId, id, 'original restored from backup', 'user:' + user.id, (a as AssetRow & { revisionId: string }).revisionId])
  return Response.json({ restored: true }, { headers })
}
