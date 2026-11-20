import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import MediaPlayer from '@/components/app/MediaPlayer'
import { getPublicMedia } from '@/lib/session'
import '../../dashboard/dashboard.css'

const load = cache(getPublicMedia)

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string | string[] }> }

const tokenOf = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

/**
 * Public player for share links and iframes. Anyone with the link can watch a public asset; a signed one also needs
 * `?token=` (see backend/media/playback.mts). Nothing else about the workspace shows.
 */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params
  const media = await load(id, tokenOf((await searchParams).token))
  return { title: media ? `${media.title} — MediaEX` : 'Not found — MediaEX', robots: { index: false, follow: false } }
}

export default async function Embed({ params, searchParams }: Props) {
  const { id } = await params
  const media = await load(id, tokenOf((await searchParams).token))
  if (!media) notFound()
  return (
    <main className="embed">
      <MediaPlayer corners={false} asset={media} track />
    </main>
  )
}
