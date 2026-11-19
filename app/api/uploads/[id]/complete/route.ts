import { pool } from '@/lib/auth'
import { getAssetRow, handle, HttpError, requireMember, toDTO } from '@/lib/media/assets'
import { storage } from '@/lib/media/storage'
import { kickWorker } from '@/lib/media/worker'

/** The browser finished sending the file: check it arrived whole, then queue it for the pipeline. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params
    const { orgId } = await requireMember(req.headers)
    const row = await getAssetRow(id, orgId)
    if (!row) throw new HttpError(404, 'That upload doesn’t exist.')
    if (row.status !== 'uploading') return Response.json({ asset: toDTO(row) })

    const stored = await storage().size(row.originalKey)
    if (stored === null) throw new HttpError(400, 'The file never arrived. Try uploading it again.')
    if (stored !== Number(row.size)) throw new HttpError(400, `Only ${stored} of ${row.size} bytes arrived. Try uploading it again.`)

    await pool.query(`update "asset" set status = 'queued', stage = 1, progress = 0, "updatedAt" = now() where id = $1`, [id])
    kickWorker()
    return Response.json({ asset: toDTO((await getAssetRow(id, orgId))!) })
  })
}
