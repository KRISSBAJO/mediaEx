import type { Pool } from 'pg'
import { backupLocation } from './storage.mts'

// Copy records outlive their asset and workspace on purpose (no foreign keys): permanent deletion removes the
// copy and then the record (see removeCopies in recovery.mts), so nothing is forgotten in the backup store.
const BACKUP_SCHEMA = `
alter table "workspace_setting" add column if not exists "backupEnabled" boolean not null default false;
alter table "workspace_setting" add column if not exists "backupChangedAt" timestamptz;
create table if not exists media_backup (
  key text primary key,
  "organizationId" text not null,
  "assetId" text not null,
  bytes bigint not null,
  status text not null check (status in ('copying', 'copied', 'failed', 'removing')),
  attempts integer not null default 0,
  "lastError" text,
  "nextAttemptAt" timestamptz not null default now(),
  "copiedAt" timestamptz,
  "createdAt" timestamptz not null default now()
);
create index if not exists media_backup_org on media_backup ("organizationId", status);
create index if not exists media_backup_due on media_backup ("nextAttemptAt") where status <> 'copied';
`

/** Bind the backup store like the media bucket: switching it silently would strand copies that erasure must reach. */
export async function migrateBackups(pool: Pool) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query("select pg_advisory_xact_lock(hashtext('mediaex.backup.schema'))")
    await client.query(BACKUP_SCHEMA)
    const location = backupLocation()
    if (location) {
      await client.query("insert into media_store_binding (kind, location) values ('backup', $1) on conflict do nothing", [location])
      const { rows } = await client.query("select location from media_store_binding where kind = 'backup'")
      const copies = await client.query("select 1 from media_backup limit 1")
      if (rows[0].location !== location) {
        if (copies.rowCount) throw new Error('The configured backup store differs from the one holding existing backup copies. Restore the previous BACKUP_* settings, or turn backups off everywhere and let the copies be removed first.')
        await client.query("update media_store_binding set location = $1 where kind = 'backup'", [location])
      }
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
