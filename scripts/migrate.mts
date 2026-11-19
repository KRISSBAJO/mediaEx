/**
 * Creates or updates the auth tables (user, session, account, verification, organization, member, invitation).
 * Runs at backend startup and on demand with `npm run db:migrate`.
 */
import { getMigrations } from 'better-auth/db/migration'
// @ts-ignore -- Node runs this file directly and needs the explicit .ts extension
import { auth, pool } from '../lib/auth.ts'

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
await pool.end()
