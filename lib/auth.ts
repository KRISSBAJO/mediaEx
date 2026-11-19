/**
 * MediaEX authentication (Better Auth + Postgres).
 *
 * Keep this file free of relative and "@/" imports: scripts/migrate.mts loads it directly with Node to create the
 * database tables, and Node can't resolve the Next.js path aliases.
 */
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { organization } from 'better-auth/plugins'
import pg from 'pg'

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3400'
const mailEnabled = Boolean(process.env.RESEND_API_KEY)

declare global {
  // one pool per process, also across dev hot reloads
  var __mxPool: pg.Pool | undefined
}
export const pool = (globalThis.__mxPool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 }))

/* ------------------------------------------------ email */
type Mail = { to: string; subject: string; text: string; link?: string }

/** Sends through Resend when RESEND_API_KEY is set; otherwise writes to the local dev mailbox (see /dev/mailbox). */
export async function sendEmail(mail: Mail) {
  if (mailEnabled) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM ?? 'MediaEX <onboarding@resend.dev>', to: mail.to, subject: mail.subject, text: mail.text }),
    })
    if (!res.ok) throw new Error(`Email provider rejected the message (${res.status})`)
    return
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn(`[mail] RESEND_API_KEY is not set; "${mail.subject}" to ${mail.to} was not sent.`)
    return
  }
  const dir = path.join(process.cwd(), '.mailbox')
  await mkdir(dir, { recursive: true })
  await appendFile(path.join(dir, 'mail.jsonl'), JSON.stringify({ ...mail, at: new Date().toISOString() }) + '\n')
  console.log(`\n[mail] ${mail.subject} → ${mail.to}\n       ${mail.link ?? ''}\n       (open ${baseURL}/dev/mailbox)\n`)
}

/* ------------------------------------------------ workspaces */
function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'workspace'
  )
}
const suffix = () => Math.random().toString(36).slice(2, 6)

export async function createPersonalWorkspace(userId: string, name: string): Promise<void> {
  const first = name.trim().split(/\s+/)[0] || 'My'
  await auth.api.createOrganization({
    body: { name: `${first}'s workspace`, slug: `${slugify(first)}-${suffix()}`, userId },
  })
}

/* ------------------------------------------------ social sign-in (only when configured) */
const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  socialProviders.google = { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
  socialProviders.github = { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET }

export const enabledSocial = { google: 'google' in socialProviders, github: 'github' in socialProviders }

/* ------------------------------------------------ auth */
export const auth = betterAuth({
  appName: 'MediaEX',
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // only demand a verified email when we can actually deliver one
    requireEmailVerification: mailEnabled,
    autoSignIn: !mailEnabled,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Reset your MediaEX password',
        text: `Hi ${user.name},\n\nSomeone asked to reset the password for your MediaEX account. If that was you, open this link within an hour:\n\n${url}\n\nIf it wasn't, you can ignore this email.`,
        link: url,
      })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Verify your email for MediaEX',
        text: `Hi ${user.name},\n\nConfirm your email to finish setting up MediaEX:\n\n${url}`,
        link: url,
      })
    },
  },
  socialProviders,
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh daily
  },
  databaseHooks: {
    user: {
      create: {
        // every new account gets a workspace of its own, unless they signed up to accept an invitation
        // (the dashboard creates one later if they end up with none)
        after: async (user) => {
          const { rows } = await pool.query(
            `select 1 from "invitation" where lower(email) = lower($1) and status = 'pending' and "expiresAt" > now() limit 1`,
            [user.email],
          )
          if (!rows.length) await createPersonalWorkspace(user.id, user.name)
        },
      },
    },
    session: {
      create: {
        // open the user's first workspace when they sign in
        before: async (session) => {
          const { rows } = await pool.query<{ organizationId: string }>(
            'select "organizationId" from "member" where "userId" = $1 order by "createdAt" asc limit 1',
            [session.userId],
          )
          return { data: { ...session, activeOrganizationId: rows[0]?.organizationId ?? null } }
        },
      },
    },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 10,
      creatorRole: 'owner',
      invitationExpiresIn: 60 * 60 * 24 * 7,
      sendInvitationEmail: async ({ id, email, organization: org, inviter }) => {
        const link = `${baseURL}/accept-invite/${id}`
        await sendEmail({
          to: email,
          subject: `${inviter.user.name} invited you to ${org.name} on MediaEX`,
          text: `${inviter.user.name} (${inviter.user.email}) invited you to join the ${org.name} workspace on MediaEX.\n\nAccept the invitation:\n${link}\n\nThe link expires in 7 days.`,
          link,
        })
      },
    }),
    nextCookies(), // must stay last
  ],
})

export type Session = typeof auth.$Infer.Session
