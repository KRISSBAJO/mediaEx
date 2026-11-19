import { getAssetRow, handle, HttpError, requireMember } from '@/lib/media/assets'
import { isLocal, storage } from '@/lib/media/storage'

/** Receives the original file when media is stored on local disk (with S3 the browser uploads to the bucket). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params
    const { orgId } = await requireMember(req.headers)
    const row = await getAssetRow(id, orgId)
    if (!row) throw new HttpError(404, 'That upload doesn’t exist.')
    if (row.status !== 'uploading') throw new HttpError(409, 'This file has already been uploaded.')
    const store = storage()
    if (!isLocal(store)) throw new HttpError(400, 'Upload to the storage URL you were given instead.')
    if (!req.body) throw new HttpError(400, 'No file was sent.')
    try {
      const received = await store.write(row.originalKey, req.body, Number(row.size))
      return Response.json({ received })
    } catch (e) {
      if (e instanceof Error && e.message === 'UPLOAD_TOO_LARGE') throw new HttpError(413, 'The file is bigger than announced.')
      throw e
    }
  })
}
