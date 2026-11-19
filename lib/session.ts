import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import type { Account } from '@/components/app/account'
import type { MediaAsset } from '@/lib/media/types'
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

/** The active workspace's assets, for the dashboard's first render (the browser keeps them fresh afterwards). */
export async function getWorkspaceAssets(): Promise<MediaAsset[]> {
  const body = (await readAuthenticated('/api/assets')) as { assets: MediaAsset[] } | null
  return body?.assets ?? []
}

/** One asset in the active workspace, or null when it doesn't exist there. */
export async function getWorkspaceAsset(id: string): Promise<MediaAsset | null> {
  const cookie = authCookies(await headers())
  if (!cookie || !/^ast_[a-z0-9]+$/.test(id)) return null
  const response = await backendFetch(`/api/assets/${id}`, { headers: { cookie } })
  if (response.status === 401 || response.status === 403 || response.status === 404) return null
  if (!response.ok) throw new Error(`MediaEX API could not load the asset (HTTP ${response.status}).`)
  return ((await response.json()) as { asset: MediaAsset }).asset
}

export type PublicMedia = Pick<MediaAsset, 'id' | 'title' | 'type' | 'status' | 'progress' | 'duration' | 'width' | 'height' | 'renditions' | 'thumbUrl' | 'posterUrl' | 'playbackUrl'>

/** What the public share/embed player needs. No session involved: anyone with the link can watch. */
export async function getPublicMedia(id: string): Promise<PublicMedia | null> {
  if (!/^ast_[a-z0-9]+$/.test(id)) return null
  const response = await backendFetch(`/api/media/${id}/info`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`MediaEX API could not load the media (HTTP ${response.status}).`)
  return response.json()
}

export async function getEnabledSocial(): Promise<{ google: boolean; github: boolean }> {
  const response = await backendFetch('/api/mediaex/providers')
  if (!response.ok) throw new Error(`MediaEX API could not load sign-in providers (HTTP ${response.status}).`)
  return response.json()
}
