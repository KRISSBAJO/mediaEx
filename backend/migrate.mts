/**
 * Creates or updates the auth tables (user, session, account, verification, organization, member, invitation),
 * then the media tables (asset). Runs at backend startup and on demand with `npm run db:migrate`. Safe to repeat.
 */
import { getMigrations } from 'better-auth/db/migration'
import { auth, pool } from './auth.mts'
import { MEDIA_SCHEMA } from './media/schema.mts'

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
console.log('[migrate] Media tables are up to date.')
// SITE_ADMIN_EMAILS are always admins (others are managed from the admin dashboard)
const admins = (process.env.SITE_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
if (admins.length) {
  const { rowCount } = await pool.query(`update "user" set role = 'admin' where lower(email) = any($1::text[]) and coalesce(role, '') <> 'admin'`, [admins])
  console.log(`[migrate] Site admins from SITE_ADMIN_EMAILS: ${admins.length} listed${rowCount ? `, ${rowCount} promoted` : ''}.`)
}
await pool.end()
