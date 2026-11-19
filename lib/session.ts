import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import type { Account } from '@/components/app/account'
import { authCookies, backendFetch } from './backend'

async function readAuthenticated(path: string) {
  const cookie = authCookies(await headers())
  if (!cookie) return null
  const response = await backendFetch(path, { headers: { cookie } })
  if (response.status === 401) return null
  if (!response.ok) throw new Error(`MediaEX API could not load the account (HTTP ${response.status}).`)
  return response.json()
}

/** The current session, or null. Cached only for this server render. */
export const getSession = cache(async (): Promise<{ user: { email: string } } | null> =>
  readAuthenticated('/api/auth/get-session'))

export async function requireAccount(): Promise<Account> {
  const account = await readAuthenticated('/api/mediaex/account') as Account | null
  if (!account) redirect('/sign-in?next=%2Fdashboard')
  return account
}

export async function getEnabledSocial(): Promise<{ google: boolean; github: boolean }> {
  const response = await backendFetch('/api/mediaex/providers')
  if (!response.ok) throw new Error(`MediaEX API could not load sign-in providers (HTTP ${response.status}).`)
  return response.json()
}
