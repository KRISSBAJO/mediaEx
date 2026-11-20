import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
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
  const cookie = authCookies(await headers())
  if (!cookie) return []
  const response = await backendFetch('/api/assets', { headers: { cookie } })
  // 401 signed out, 423 the workspace is suspended (the dashboard shows why)
  if (response.status === 401 || response.status === 423) return []
  if (!response.ok) throw new Error(`MediaEX API could not load the media (HTTP ${response.status}).`)
  return ((await response.json()) as { assets: MediaAsset[] }).assets
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

export type PublicMedia = Pick<MediaAsset, 'id' | 'title' | 'type' | 'status' | 'progress' | 'duration' | 'width' | 'height' | 'renditions' | 'thumbUrl' | 'posterUrl' | 'playbackUrl' | 'playbackUrls' | 'captions'>

/** What the public share/embed player needs. No session involved: anyone with the link can watch. */
export async function getPublicMedia(id: string, token?: string): Promise<PublicMedia | null> {
  if (!/^ast_[a-z0-9]+$/.test(id)) return null
  // signed assets: the viewer's playback token rides along, and the URLs that come back carry it
  const query = token && /^\d{10}\.[A-Za-z0-9_-]{43}$/.test(token) ? `?token=${token}` : ''
  const response = await backendFetch(`/api/media/${id}/info${query}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`MediaEX API could not load the media (HTTP ${response.status}).`)
  return response.json()
}

export async function getEnabledSocial(): Promise<{ google: boolean; github: boolean }> {
  const response = await backendFetch('/api/mediaex/providers')
  if (!response.ok) throw new Error(`MediaEX API could not load sign-in providers (HTTP ${response.status}).`)
  return response.json()
}

/** The signed-in site admin, for the /admin pages. Not signed in → sign-in; signed in but not an admin → 404. */
export async function requireSiteAdmin(): Promise<{ id: string; email: string; name: string }> {
  const cookie = authCookies(await headers())
  if (!cookie) redirect('/sign-in?next=%2Fadmin')
  const response = await backendFetch('/api/admin/me', { headers: { cookie } })
  if (response.status === 401) redirect('/sign-in?next=%2Fadmin')
  if (response.status === 403) notFound()
  if (!response.ok) throw new Error(`MediaEX API could not check admin access (HTTP ${response.status}).`)
  return ((await response.json()) as { admin: { id: string; email: string; name: string } }).admin
}
