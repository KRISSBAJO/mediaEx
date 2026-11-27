'use client'

import { defaultRoles,memberAc } from 'better-auth/plugins/organization/access'
import { organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({ plugins: [organizationClient({roles:{...defaultRoles,contributor:memberAc,reviewer:memberAc,viewer:memberAc}})] })

/** Turns a Better Auth error into a sentence for the form. */
export function authMessage(error: { code?: string; message?: string; status?: number } | null | undefined, fallback = 'Something went wrong. Try again.') {
  if (!error) return fallback
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'That email and password don’t match an account.'
    case 'EMAIL_NOT_VERIFIED':
      return 'Verify your email first — we sent you a link when you signed up.'
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account with this email already exists. Sign in instead.'
    case 'PASSWORD_TOO_SHORT':
      return 'Use at least 8 characters.'
    case 'INVALID_TOKEN':
      return 'This link is invalid or has expired. Ask for a new one.'
  }
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.'
  return error.message || fallback
}
