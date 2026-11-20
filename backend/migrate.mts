/**
 * Creates or updates the auth tables (user, session, account, verification, organization, member, invitation),
 * then the media tables (asset). Runs at backend startup and on demand with `npm run db:migrate`. Safe to repeat.
 */
import { getMigrations } from 'better-auth/db/migration'
import { auth, bootstrapVerifiedAdmins, pool } from './auth.mts'
import { MEDIA_SCHEMA, LIBRARY_INDEXES } from './media/schema.mts'
import { migrateStorage } from './media/storage-schema.mts'
import { PERMANENT_CLEANUP_SCHEMA } from './media/permanent-cleanup-schema.mts'
import { RECOVERY_SCHEMA } from './media/recovery-schema.mts'
import { PRESET_SCHEMA } from './media/preset-schema.mts'
import { OPERATIONS_SCHEMA } from './media/operations-schema.mts'

if (!process.env.DATABASE_URL) {
  console.error('[migrate] DATABASE_URL is not set.')
  process.exit(1)
}

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options)
if (!toBeCreated.length && !toBeAdded.length) {
  console.log('[migrate] Database is up to date.')
} else {
  console.log(`[migrate] Creating ${toBeCreated.map((t) => t.table).join(', ') || 'no tables'}; adding columns to ${toBeAdded.map((t) => t.table).join(', ') || 'no tables'}.`)
  await runMigrations()
  console.log('[migrate] Done.')
}
await pool.query(MEDIA_SCHEMA)
await migrateStorage(pool)
await pool.query(RECOVERY_SCHEMA)
await pool.query(PERMANENT_CLEANUP_SCHEMA)
await pool.query(LIBRARY_INDEXES)
await pool.query(PRESET_SCHEMA)
await pool.query(OPERATIONS_SCHEMA)
console.log('[migrate] Media tables are up to date.')
const promoted = await bootstrapVerifiedAdmins()
if (promoted) console.log(`[migrate] Promoted ${promoted} verified bootstrap admin account(s).`)
await pool.end()
