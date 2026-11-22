import { baseURL, pool, sendEmail } from './auth.mts'

export const RESET_MAIL_SCHEMA = `
create table if not exists password_reset_mail (
  "verificationId" text primary key references verification(id) on delete cascade,
  callback text not null,
  attempts integer not null default 0,
  "nextAttemptAt" timestamptz not null default now()
);
create index if not exists password_reset_mail_due on password_reset_mail ("nextAttemptAt");
`

export async function deliverResetMail() {
  await pool.query(`delete from password_reset_mail m using verification v
    where v.id = m."verificationId" and v."expiresAt" <= now()`)
  if (!process.env.RESEND_API_KEY?.trim() || !process.env.MAIL_FROM?.trim()) return 0
  const {rows} = await pool.query(`with due as (
    select m."verificationId" from password_reset_mail m join verification v on v.id = m."verificationId"
    where m."nextAttemptAt" <= now() and v."expiresAt" > now()
    order by m."nextAttemptAt" limit 5 for update of m skip locked
  ), claimed as (
    update password_reset_mail m set attempts = attempts + 1, "nextAttemptAt" = now() + interval '2 minutes'
    from due where m."verificationId" = due."verificationId" returning m.*
  )
  select c."verificationId", c.callback, c.attempts, v.identifier, u.email, u.name from claimed c
  join verification v on v.id = c."verificationId" join "user" u on u.id = v.value`)
  for (const row of rows) {
    if (!row.identifier.startsWith('reset-password:')) throw new Error('Invalid reset verification record.')
    const token = row.identifier.slice('reset-password:'.length)
    const url = new URL('/api/auth/reset-password/' + encodeURIComponent(token), baseURL)
    url.searchParams.set('callbackURL', row.callback)
    try {
      await sendEmail({
        to: row.email, subject: 'Reset your MediaEX password',
        text: 'Hi ' + row.name + ',\n\nOpen this link to reset your MediaEX password. It expires one hour after your request.\n\n' + url.href + '\n\nIf you did not request this, you can ignore this message.',
      }, 'mediaex-password-reset-' + row.verificationId)
      await pool.query('delete from password_reset_mail where "verificationId"=$1', [row.verificationId])
    } catch {
      console.error('[mail] Password reset delivery failed. Retrying before expiry.')
      await pool.query(`update password_reset_mail set "nextAttemptAt" = now() + interval '15 seconds' * least(20, power(2, least(attempts, 5)))
        where "verificationId"=$1`, [row.verificationId])
    }
  }
  return rows.length
}

export function startResetMail() {
  if (process.env.NODE_ENV !== 'production') return
  let running = false
  async function pass() {
    if (running) return
    running = true
    try { await deliverResetMail() }
    catch { console.error('[mail] Password reset delivery pass failed. Will retry.') }
    finally { running = false }
  }
  void pass()
  setInterval(() => void pass(), 5000).unref()
}
