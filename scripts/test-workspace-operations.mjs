import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import pg from 'pg'
import { MEDIA_SCHEMA } from '../backend/media/schema.mts'
import { RECOVERY_SCHEMA } from '../backend/media/recovery-schema.mts'
import { PRESET_SCHEMA } from '../backend/media/preset-schema.mts'
import { OPERATIONS_SCHEMA } from '../backend/media/operations-schema.mts'
import { migrateStorage } from '../backend/media/storage-schema.mts'

test('workspace usage, issue retention and expired upload cleanup', async t => {
  const configured = process.env.MEDIAEX_TEST_DATABASE_URL || process.env.DATABASE_URL
  if (!configured) return t.skip('Supply an isolated local PostgreSQL database URL.')
  const url = new URL(configured)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'This fixture needs a local test database.')
  const schema = 'test_operations_' + randomUUID().replaceAll('-', '')
  const admin = new pg.Pool({ connectionString: url.href })
  const media = await mkdtemp(path.join(os.tmpdir(), 'mediaex-operations-'))
  url.searchParams.set('options', '-c search_path=' + schema)
  process.env.DATABASE_URL = url.href
  process.env.MEDIA_DIR = media
  process.env.MEDIAEX_LEGACY_STORAGE = 'local'
  delete process.env.MEDIA_CLEAN_EXPIRED_UPLOADS
  const { pool } = await import('../backend/auth.mts')
  const { workspaceOperations, committedStorage, processingMinutesForPeriod } = await import('../backend/media/operations.mts')
  const { cleanExpiredUploads, pruneOperationalHistory } = await import('../backend/media/maintenance.mts')
  try {
    await admin.query('create schema ' + schema)
    await pool.query('create table organization(id text primary key); create table "user"(id text primary key)')
    await pool.query(MEDIA_SCHEMA)
    await migrateStorage(pool)
    await pool.query(RECOVERY_SCHEMA)
    await pool.query(PRESET_SCHEMA)
    await pool.query("insert into organization values ('a'),('b')")
    const asset = (id, org, status, size, duration = 0) => pool.query(`
      insert into asset (id,"organizationId",title,type,status,"fileName",size,duration,"originalKey")
      values ($1,$2,$1,'video',$3,'clip.mp4',$4,$5,$2::text || '/' || $1::text || '/original.mp4')`, [id, org, status, size, duration])
    await asset('legacy','a','ready',100,120)
    await pool.query(`update asset set "readyAt"=now(), "outputSize"=50 where id='legacy'`)
    await pool.query(OPERATIONS_SCHEMA)
    await pool.query(OPERATIONS_SCHEMA)
    await asset('new','a','processing',200,60)
    await asset('foreign','b','processing',99999,600)
    await pool.query(`update asset set status='ready',"readyAt"=now() where status='processing'`)
    await pool.query(`update asset set "readyAt"=now() where id='new'`)
    await asset('issue','a','processing',20)
    await pool.query("update asset set status='failed' where id='issue'")
    await pool.query(`insert into caption ("assetId",lang,label,status) values ('issue','fr','French','processing');
      update caption set status='failed',error='unredacted provider response' where "assetId"='issue';
      insert into webhook_endpoint (id,"organizationId",url,secret) values ('ep','a','https://example.org/private-endpoint','fixture');
      insert into webhook_delivery (id,"endpointId","organizationId",event,payload) values ('dlv_fixture','ep','a','webhook.test','{}');
      update webhook_delivery set status='failed',"responseStatus"=500,"responseBody"='unredacted provider response' where id='dlv_fixture'`)
    await pool.query(`insert into view_session (id,"assetId","organizationId","viewerId",bytes,errors) values ('v','new','a','viewer',128,1)`)
    await pool.query(`update view_session set bytes=bytes+64, errors=errors+1 where id='v'`)
    await pool.query(`insert into asset_variant ("assetId",key,params,format,bytes) values ('new','key','w=24','webp',17)`)
    await pool.query(`insert into asset_revision (id,"organizationId","assetId",snapshot,size,"outputSize") values (gen_random_uuid(),'a','legacy','{}',100,30)`)
    await asset('open','a','uploading',80)
    await asset('stale','a','uploading',60)
    await asset('cancelled','a','uploading',900)
    await pool.query(`update asset set "uploadExpiresAt"=now()+interval '1 day' where id in ('open','cancelled');
      update asset set "deletedAt"=now() where id='cancelled';
      update asset set "uploadExpiresAt"=now()-interval '1 day' where id='stale'`)
    const report = await workspaceOperations('a', 'owner')
    assert.equal(report.originalBytes, 320)
    assert.equal(report.encodedBytes, 50)
    assert.equal(report.transformBytes, 17)
    assert.equal(report.versionBytes, 130)
    assert.equal(report.playerBytes, 192)
    assert.equal(report.processingMinutes, 3)
    assert.equal(report.reservations, 1)
    assert.equal(report.reservedBytes, 80)
    assert.equal(report.expiredUploads, 1)
    assert.equal(report.expiredBytes, 60)
    assert.equal(report.errors, 4)
    assert.equal(report.cleanupEnabled, false)
    assert.equal(await committedStorage('a'), 597)
    assert.deepEqual(report.details.map(i => i.category).sort(), ['captions', 'encoding', 'playback', 'webhook'])
    assert.equal(report.details.find(i => i.category === 'webhook').httpStatus, 500)
    assert.equal(report.details.find(i => i.category === 'webhook').deliveryId, 'dlv_fixture')
    assert.equal(JSON.stringify(report).includes('unredacted provider response'), false)
    assert.equal(JSON.stringify(report).includes('private-endpoint'), false)
    assert.equal((await workspaceOperations('a','member')).details, null)
    assert.deepEqual((await workspaceOperations('b','admin')).details, [])
    await pool.query(`update asset set "deletedAt"=now() where id='issue'`)
    assert.equal((await workspaceOperations('a','admin')).details.find(i=>i.category==='encoding').assetId, null)
    await pool.query(`delete from asset where id='new'`)
    assert.equal((await workspaceOperations('a','admin')).processingMinutes, 3)
    assert.equal((await workspaceOperations('a','admin')).playerBytes, 192)
    const periodStart = new Date(Date.now() - 10 * 86400000)
    const periodEnd = new Date(periodStart.getTime() + 3600000)
    await pool.query(`insert into workspace_processing_completion (org_id,completed_at,media_seconds) values
      ('a',$1::timestamptz - interval '1 second',60),('a',$1,30),('a',$2,60),('a',now()-interval '401 days',60)`, [periodStart,periodEnd])
    assert.equal(await processingMinutesForPeriod('a', periodStart, periodEnd), 0.5)
    await pool.query(`insert into workspace_media_error (org_id,category,reference,recorded_at) values ('a','webhook','old',now()-interval '31 days');
      insert into workspace_usage_day (org_id,day,player_bytes) values ('a',current_date-100,1)`)
    await pruneOperationalHistory()
    assert.equal((await pool.query("select * from workspace_processing_completion where completed_at < now()-interval '400 days'")).rowCount, 0)
    assert.equal((await pool.query("select * from workspace_media_error where reference='old'")).rowCount, 0)
    assert.equal((await pool.query('select * from workspace_usage_day where day = current_date-100')).rowCount, 0)
    await mkdir(path.join(media,'a','stale'), { recursive: true })
    const staleFile = path.join(media,'a','stale','original.mp4')
    await writeFile(staleFile, 'partial')
    await cleanExpiredUploads()
    assert.ok(await stat(staleFile))
    process.env.MEDIA_CLEAN_EXPIRED_UPLOADS = 'on'
    const lock = await pool.connect()
    try {
      await lock.query('begin')
      await lock.query("select pg_advisory_xact_lock(hashtextextended('stale',0))")
      await cleanExpiredUploads()
      assert.ok(await stat(staleFile))
    } finally {
      await lock.query('rollback')
      lock.release()
    }
    await cleanExpiredUploads()
    await assert.rejects(stat(staleFile), { code: 'ENOENT' })
    assert.equal((await pool.query("select id from asset where id='stale'")).rowCount, 0)
    assert.equal((await pool.query("select id from asset where id in ('open','cancelled')")).rowCount, 2)
    // An inconsistent record must never send cleanup into a different workspace.
    await asset('bad','a','uploading',40)
    await pool.query(`update asset set "uploadExpiresAt"=now()-interval '1 day',"originalKey"='b/foreign/original.mp4' where id='bad'`)
    await mkdir(path.join(media,'b','foreign'), { recursive: true })
    const protectedFile = path.join(media,'b','foreign','original.mp4')
    await writeFile(protectedFile, 'private')
    await cleanExpiredUploads()
    assert.ok(await stat(protectedFile))
    assert.equal((await pool.query(`select id from asset where id='bad' and "cleanupRetryAt">now()`)).rowCount, 1)
  } finally {
    await pool.end()
    await admin.query('drop schema if exists ' + schema + ' cascade')
    await admin.end()
    if (path.dirname(media) === path.resolve(os.tmpdir()) && path.basename(media).startsWith('mediaex-operations-')) {
      await rm(media, { recursive: true, force: true })
    }
  }
})
