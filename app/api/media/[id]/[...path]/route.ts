import { getAssetRow, isMemberOf, prefixOf } from '@/lib/media/assets'
import { storage } from '@/lib/media/storage'

const SAFE_REL = /^[A-Za-z0-9_-][A-Za-z0-9._/-]*$/

/**
 * Serves an asset's files.
 *  - Playback (hls/…), thumbnails and posters: anyone with the link (asset IDs are unguessable), so embeds work.
 *  - The original (`/original`): members of the asset's workspace only, as a download.
 */
async function serve(req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await ctx.params
  const rel = path.join('/')
  const row = await getAssetRow(id)
  if (!row) return new Response('Not found', { status: 404 })

  if (rel === 'original') {
    if (!(await isMemberOf(req.headers, row.organizationId))) return new Response('Not found', { status: 404 })
    return storage().serve(row.originalKey, req, { download: row.fileName })
  }

  const publicFile = rel === 'thumb.jpg' || rel === 'thumb.png' || rel === 'poster.jpg' || (rel.startsWith('hls/') && row.status === 'ready')
  if (!publicFile || !SAFE_REL.test(rel) || rel.split('/').includes('..')) return new Response('Not found', { status: 404 })

  const res = await storage().serve(`${prefixOf(row)}/${rel}`, req)
  res.headers.set('Access-Control-Allow-Origin', '*') // players on other sites may load the stream
  return res
}

export { serve as GET, serve as HEAD }
