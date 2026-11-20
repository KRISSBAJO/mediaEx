import { pool } from '../auth.mts'
import { prefixOf, type AssetRow } from './assets.mts'
import { cleanupEnabled } from './operations.mts'
import { cleanPermanentDeletions, purgeExpiredTrash } from './recovery.mts'
import { storage } from './storage.mts'

const batchSize = 10
const expired = `status = 'uploading' and "uploadExpiresAt" <= now() and "deletedAt" is null`

/** Recheck under the same locks as upload completion. On object-store failure leave the expired row for retry. */
export async function cleanExpiredUploads() {
  if (!cleanupEnabled()) return
  const candidates = await pool.query<{ id: string }>(
    `select id from asset where ${expired} and ("cleanupRetryAt" is null or "cleanupRetryAt" <= now())
     order by "uploadExpiresAt", id limit $1`, [batchSize])
  for (const { id } of candidates.rows) {
    const db = await pool.connect()
    try {
      await db.query('begin')
      const lock = await db.query<{ locked: boolean }>('select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as locked', [id])
      if (lock.rows[0].locked) {
        const { rows: [row] } = await db.query<AssetRow>(`select * from asset where id = $1 and ${expired} for update skip locked`, [id])
        if (row) {
          const prefix = prefixOf(row)
          if (prefix !== row.organizationId + '/' + row.id || prefix.split('/').length !== 2 || !row.originalKey.startsWith(prefix + '/')) {
            throw new Error('Unexpected upload prefix')
          }
          const store = storage(row)
          if (row.upload?.uploadId) await store.multipartAbort(row.originalKey, row.upload.uploadId)
          await store.removePrefix(prefix)
          await db.query('delete from asset where id = $1', [id])
        }
      }
      await db.query('commit')
    } catch {
      await db.query('rollback')
      await db.query(`update asset set "cleanupRetryAt" = now() + interval '1 hour' where id = $1 and ${expired}`, [id])
      console.warn('[media maintenance] An expired upload could not be cleaned. It will be retried.')
    } finally {
      db.release()
    }
  }
}

export async function pruneOperationalHistory() {
  // Annual subscriptions need their full period, including exact start/end times.
  await pool.query(`delete from workspace_processing_completion where id in
    (select id from workspace_processing_completion where completed_at < now() - interval '400 days' order by completed_at limit 2000 for update skip locked)`)
  await pool.query(`delete from workspace_media_error where id in
    (select id from workspace_media_error where recorded_at < now() - interval '30 days' order by recorded_at limit 2000 for update skip locked)`)
  await pool.query(`delete from workspace_usage_day where (org_id, day) in
    (select org_id, day from workspace_usage_day where day < (now() at time zone 'UTC')::date - 89 order by day limit 2000 for update skip locked)`)
}

export function startOperationsMaintenance() {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      await cleanPermanentDeletions()
      await pruneOperationalHistory()
      if (cleanupEnabled()) {
        await cleanExpiredUploads()
        await purgeExpiredTrash()
      }
    } catch {
      console.warn('[media maintenance] Maintenance will retry on the next interval.')
    } finally {
      running = false
    }
  }
  void run()
  setInterval(() => void run(), 15 * 60 * 1000).unref()
}
