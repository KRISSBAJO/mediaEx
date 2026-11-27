/**
 * MediaEX authentication (Better Auth + Postgres).
 *
 * The API and its database migration load this module directly with Node.
 */
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { betterAuth } from 'better-auth'
import { defaultRoles,memberAc } from 'better-auth/plugins/organization/access'
import { admin, organization, genericOAuth } from 'better-auth/plugins'
import pg from 'pg'

export const baseURL = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3400').origin
const mailEnabled = Boolean(process.env.RESEND_API_KEY)

declare global {
  // one pool per process, also across dev hot reloads
  var __mxPool: pg.Pool | undefined
}
export const pool = (globalThis.__mxPool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 }))

/* ------------------------------------------------ email */
type Mail = { to: string; subject: string; text: string; link?: string }

/** Sends through Resend when RESEND_API_KEY is set; otherwise writes to the local dev mailbox (see /dev/mailbox). */
export async function sendEmail(mail: Mail, idempotencyKey?: string) {
  if (process.env.RESEND_API_KEY?.trim()) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      signal: AbortSignal.timeout(12000),
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
export function personalWorkspaceName(name: string) {
  const first = name.trim().split(/\s+/)[0] || 'My'
  return { name: `${first}'s workspace`, slug: `${slugify(first)}-${crypto.randomUUID().slice(0, 8)}` }
}

export async function createPersonalWorkspace(userId: string, name: string): Promise<void> {
  await auth.api.createOrganization({ body: { ...personalWorkspaceName(name), userId } })
}

/* ------------------------------------------------ social sign-in (only when configured) */
const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  socialProviders.google = { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
  socialProviders.github = { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET }

const enterpriseDomains = (process.env.ENTERPRISE_OIDC_DOMAINS??'').split(',').map(d=>d.trim().toLowerCase()).filter(Boolean)
const enterpriseEnabled = Boolean(process.env.ENTERPRISE_OIDC_DISCOVERY?.startsWith('https://') && process.env.ENTERPRISE_OIDC_CLIENT_ID && process.env.ENTERPRISE_OIDC_CLIENT_SECRET && enterpriseDomains.length)
export const enabledSocial = { enterprise:enterpriseEnabled, google: 'google' in socialProviders, github: 'github' in socialProviders }

/* ------------------------------------------------ site admins */
/** Configured email addresses are eligible for bootstrap once ownership is verified. */
export const siteAdminEmails = () =>
  (process.env.SITE_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+$/.test(e))

export async function bootstrapVerifiedAdmins(userId?: string) {
  const emails = siteAdminEmails()
  if (!emails.length) return 0
  const { rowCount } = await pool.query(
    `update "user" set role='admin', "updatedAt"=now()
     where "emailVerified" is true and lower(email)=any($1::text[]) and ($2::text is null or id=$2)
       and not ('admin'=any(string_to_array(coalesce(role,''), ',')))`, [emails, userId ?? null],
  )
  return rowCount ?? 0
}

export function isVerifiedAdmin(user: {emailVerified: boolean; role?: string | null}, session: {impersonatedBy?: string | null}) {
  return user.emailVerified === true && !session.impersonatedBy && (user.role ?? '').split(',').includes('admin')
}

/** Writes one line to the admin audit log; never throws (an audit failure mustn't break the action). */
export async function audit(entry: { adminId: string | null; action: string; targetType: string; targetId: string | null; details?: Record<string, unknown> }) {
  await pool
    .query(
      `insert into "admin_audit" (id, "adminId", "adminEmail", action, "targetType", "targetId", details)
       values ($1, $2, (select email from "user" where id = $2), $3, $4, $5, $6)`,
      [`aud_${randomUUID().replace(/-/g, '').slice(0, 20)}`, entry.adminId, entry.action, entry.targetType, entry.targetId, JSON.stringify(entry.details ?? {})],
    )
    .catch((e) => console.error('[admin] audit write failed:', e instanceof Error ? e.message : e))
}

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
    sendResetPassword: async ({ user, url, token }) => {
      if (process.env.NODE_ENV === 'production') {
        // Queue only a reference to the expiring verification row. The worker resolves the recipient at send time.
        const result = await pool.query(
          'insert into password_reset_mail ("verificationId", callback) select id, $2 from verification where identifier = $1 and value = $3 on conflict do nothing',
          ['reset-password:' + token, new URL(url).searchParams.get('callbackURL') ?? '', user.id],
        )
        if (!result.rowCount) throw new Error('Could not queue password reset.')
        return
      }
      await sendEmail({
        to: user.email,
        subject: 'Reset your MediaEX password',
        text: `Hi ${user.name},\n\nSomeone asked to reset the password for your MediaEX account. If that was you, open this link within an hour:\n\n${url}\n\nIf it wasn't, you can ignore this email.`,
        link: url,
      })
    },
  },
  emailVerification: {
    afterEmailVerification: async (user) => { await bootstrapVerifiedAdmins(user.id) },
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
  hooks: {
    before: createAuthMiddleware(async ctx => {
      if (ctx.path === '/request-password-reset' && process.env.NODE_ENV === 'production' &&
          (!process.env.RESEND_API_KEY?.trim() || !process.env.MAIL_FROM?.trim())) {
        throw APIError.fromStatus('SERVICE_UNAVAILABLE', { message: 'Password reset email is temporarily unavailable. Please try again later.' })
      }
      if (!ctx.path.startsWith('/admin/') || ctx.path === '/admin/stop-impersonating') return
      const current = await getSessionFromCtx<{role?: string | null}, {impersonatedBy?: string | null}>(ctx, { disableCookieCache: true })
      if (!current) throw APIError.fromStatus('UNAUTHORIZED', { message: 'Sign in to continue.' })
      if (!isVerifiedAdmin(current.user, current.session)) throw APIError.fromStatus('FORBIDDEN', { message: 'A verified site admin account is required.' })
      // Keep privilege changes on the audited MediaEX endpoint, which checks the target atomically.
      const fields = ctx.body?.data ?? {}
      if (ctx.path === '/admin/set-role' ||
          (ctx.path === '/admin/create-user' && (ctx.body?.role ?? fields.role ?? 'user') !== 'user') ||
          (ctx.path === '/admin/update-user' && Object.hasOwn(fields, 'role'))) {
        throw APIError.fromStatus('FORBIDDEN', { message: 'Manage site admins in the MediaEX administration dashboard.' })
      }
      // Only a mailbox challenge or a trusted provider may attest ownership of an email.
      if ((ctx.path === '/admin/create-user' || ctx.path === '/admin/update-user') &&
          (Object.hasOwn(fields, 'emailVerified') || (ctx.path === '/admin/update-user' && Object.hasOwn(fields, 'email')))) {
        throw APIError.fromStatus('FORBIDDEN', { message: 'Use the verified email flow to establish ownership.' })
      }
    }),
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
          // This also covers existing accounts whose provider has just verified the email.
          await bootstrapVerifiedAdmins(session.userId)
          const { rows } = await pool.query<{ organizationId: string }>(
            'select "organizationId" from "member" where "userId" = $1 order by "createdAt" asc limit 1',
            [session.userId],
          )
          return { data: { ...session, activeOrganizationId: rows[0]?.organizationId ?? null } }
        },
        // every impersonation goes in the audit log, with who did it and when it expires
        after: async (session) => {
          const by = (session as { impersonatedBy?: string | null }).impersonatedBy
          if (by) await audit({ adminId: by, action: 'user.impersonate.start', targetType: 'user', targetId: session.userId, details: { session: session.id, expiresAt: session.expiresAt } })
        },
      },
      delete: {
        after: async (session) => {
          const by = (session as { impersonatedBy?: string | null }).impersonatedBy
          if (by) await audit({ adminId: by, action: 'user.impersonate.stop', targetType: 'user', targetId: session.userId, details: { session: session.id } })
        },
      },
    },
  },
  plugins: [
    // site admins: roles, bans (a ban signs the user out everywhere) and impersonation (1 hour, never of another admin)
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
      impersonationSessionDuration: 60 * 60,
      bannedUserMessage: 'This account has been suspended. Contact MediaEX support if you think this is a mistake.',
    }),
    genericOAuth({config:enterpriseEnabled ?
      [{providerId:'enterprise',discoveryUrl:process.env.ENTERPRISE_OIDC_DISCOVERY,clientId:process.env.ENTERPRISE_OIDC_CLIENT_ID!,
        clientSecret:process.env.ENTERPRISE_OIDC_CLIENT_SECRET,pkce:true,requireIdTokenVerification:true,requireEmailVerification:true,
        mapProfileToUser(profile) {
          const domain=typeof profile.email==='string'?profile.email.toLowerCase().split('@').pop():undefined
          if(!domain || !enterpriseDomains.includes(domain))throw new Error('Email is outside the configured enterprise domains.')
          return {}
        },scopes:['openid','profile','email']}] : []}),
    organization({
      roles:{...defaultRoles,contributor:memberAc,reviewer:memberAc,viewer:memberAc},
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
  ],
})

export type Session = typeof auth.$Infer.Session
