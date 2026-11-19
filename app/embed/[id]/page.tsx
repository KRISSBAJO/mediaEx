import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import MediaPlayer from '@/components/app/MediaPlayer'
import { getAssetRow, toDTO } from '@/lib/media/assets'
import '../../dashboard/dashboard.css'

/** Public player for share links and iframes. Anyone with the link can watch; nothing else about the workspace shows. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const row = await getAssetRow(id)
  return { title: row ? `${row.title} — MediaEX` : 'Not found — MediaEX', robots: { index: false, follow: false } }
}

export default async function Embed({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await getAssetRow(id)
  if (!row || row.status === 'uploading') notFound()
  const a = toDTO(row)
  return (
    <main className="embed">
      <MediaPlayer
        corners={false}
        asset={{
          type: a.type,
          status: a.status,
          playbackUrl: a.playbackUrl,
          posterUrl: a.posterUrl,
          thumbUrl: a.thumbUrl,
          duration: a.duration,
          width: a.width,
          height: a.height,
          renditions: a.renditions,
          progress: a.progress,
          title: a.title,
        }}
      />
    </main>
  )
}
