import { pool } from '@/lib/auth'
import { getAssetRow, handle, HttpError, prefixOf, requireMember, toDTO } from '@/lib/media/assets'
import { storage } from '@/lib/media/storage'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params
    const { orgId } = await requireMember(req.headers)
    const row = await getAssetRow(id, orgId)
    if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
    return Response.json({ asset: toDTO(row) }, { headers: { 'Cache-Control': 'no-store' } })
  })
}

/** Rename or retag. Body: { title?, tags? } */
export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params
    const { orgId } = await requireMember(req.headers)
    const row = await getAssetRow(id, orgId)
    if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
    const body = (await req.json().catch(() => null)) as { title?: unknown; tags?: unknown } | null

    const title = body?.title === undefined ? row.title : typeof body.title === 'string' ? body.title.trim() : ''
    if (!title || title.length > 200) throw new HttpError(400, 'Titles need 1–200 characters.')
    let tags = row.tags
    if (body?.tags !== undefined) {
      if (!Array.isArray(body.tags)) throw new HttpError(400, 'Tags must be a list.')
      tags = [...new Set(body.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))]
      if (tags.length > 20 || tags.some((t) => t.length > 32)) throw new HttpError(400, 'Use up to 20 tags of 32 characters or fewer.')
    }
    await pool.query(`update "asset" set title = $2, tags = $3, "updatedAt" = now() where id = $1`, [id, title, tags])
    return Response.json({ asset: toDTO((await getAssetRow(id, orgId))!) })
  })
}

/** Deletes the asset and every stored file: the original, renditions and thumbnails. */
export async function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params
    const { orgId } = await requireMember(req.headers)
    const row = await getAssetRow(id, orgId)
    if (!row) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
    await pool.query(`delete from "asset" where id = $1`, [id])
    await storage().removePrefix(prefixOf(row))
    return new Response(null, { status: 204 })
  })
}
