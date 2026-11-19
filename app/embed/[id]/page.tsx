import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import MediaPlayer from '@/components/app/MediaPlayer'
import { getPublicMedia } from '@/lib/session'
import '../../dashboard/dashboard.css'

const load = cache(getPublicMedia)

/** Public player for share links and iframes. Anyone with the link can watch; nothing else about the workspace shows. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const media = await load(id)
  return { title: media ? `${media.title} — MediaEX` : 'Not found — MediaEX', robots: { index: false, follow: false } }
}

export default async function Embed({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const media = await load(id)
  if (!media) notFound()
  return (
    <main className="embed">
      <MediaPlayer corners={false} asset={media} />
    </main>
  )
}
