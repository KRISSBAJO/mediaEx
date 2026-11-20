'use client'

import { useState } from 'react'
import type { MediaAsset } from '@/lib/media/types'
import Icon from './Icon'
import { request } from './library'
import { copyText, toast } from './ui'

export type SignedLink = { expiresAt: string; embedUrl: string; playbackUrl: string | null }

export function createSignedLink(id: string, expiresIn = 86400) {
  return request<SignedLink>(`/api/assets/${id}/playback-token`, { method: 'POST', json: { expiresIn } })
}

export default function ShareLink({ asset }: { asset: MediaAsset }) {
  const [busy, setBusy] = useState(false)
  if (asset.status !== 'ready' || asset.moderation !== 'approved' || asset.takenDown) return null
  const signed = asset.playback === 'signed'

  async function copy() {
    setBusy(true)
    try {
      const url = signed ? (await createSignedLink(asset.id)).embedUrl : `${window.location.origin}/embed/${asset.id}`
      await copyText(url, signed ? 'Signed link copied for 24 hours' : 'Share link copied')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not create the share link.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={copy}>
      <Icon name="link" size={15} /> {signed ? 'Copy 24-hour link' : 'Copy share link'}
    </button>
  )
}
