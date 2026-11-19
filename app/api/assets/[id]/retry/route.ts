import { pool } from '@/lib/auth'
import { getAssetRow, handle, HttpError, requireMember, toDTO } from '@/lib/media/assets'
import { kickWorker } from '@/lib/media/worker'

/** Runs the pipeline again from the stored original (after a failure, or to rebuild the outputs). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params
    const { orgId } = await requireMember(req.headers)
    const row = await getAssetRow(id, orgId)
    if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
    if (row.status !== 'ready' && row.status !== 'failed') throw new HttpError(409, 'This asset is still being processed.')
    await pool.query(`update "asset" set status = 'queued', stage = 1, progress = 0, error = null, attempts = 0, "updatedAt" = now() where id = $1`, [id])
    kickWorker()
    return Response.json({ asset: toDTO((await getAssetRow(id, orgId))!) })
  })
}
