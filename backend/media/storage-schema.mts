import type { Pool } from 'pg'
import { legacyStorageKind } from './storage.mts'

export async function migrateStorage(pool: Pool) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query("select pg_advisory_xact_lock(hashtext('mediaex.storage.schema'))")
    const legacy = legacyStorageKind()
    if (!process.env.MEDIAEX_LEGACY_STORAGE && process.env.MEDIAEX_S3_WORKSPACE_IDS !== undefined && process.env.S3_BUCKET) {
      const { rows: [state] } = await client.query(`select exists(select 1 from asset) as existing_assets,
        exists(select 1 from pg_attribute where attrelid='asset'::regclass and attname='storageBackend' and not attisdropped) as already_bound`)
      if (state.existing_assets && !state.already_bound) {
        throw new Error('Set MEDIAEX_LEGACY_STORAGE to the store holding the existing media before enabling mixed storage.')
      }
    }
    await client.query(`alter table "asset" add column if not exists "storageBackend" text
      not null default '${legacy}' check ("storageBackend" in ('local', 's3'))`)
    await client.query('create table if not exists media_store_binding (kind text primary key, location text not null)')
    await client.query(`create table if not exists media_store_transfer (
      "assetId" text not null references asset(id) on delete cascade,
      "organizationId" text not null, "revisionId" text primary key, prefix text not null, digest text not null,
      objects integer not null, bytes bigint not null, "migratedAt" timestamptz not null default now(),
      "rolledBackAt" timestamptz
    )`)
    await client.query('create index if not exists media_transfer_asset_idx on media_store_transfer ("assetId")')
    const { S3_ENDPOINT, S3_BUCKET } = process.env
    if (S3_ENDPOINT && S3_BUCKET) {
      const location = S3_ENDPOINT.replace(/\/+$/, '') + '/' + S3_BUCKET
      await client.query("insert into media_store_binding (kind, location) values ('s3', $1) on conflict do nothing", [location])
      const { rows } = await client.query("select location from media_store_binding where kind = 's3'")
      if (rows[0].location !== location) throw new Error('Configured media bucket differs from the database storage binding. Restore the configured bucket or complete an explicit migration.')
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
