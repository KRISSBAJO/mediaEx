import { handle, listAssets, requireMember, toDTO } from '@/lib/media/assets'

/** Every asset in the active workspace, newest first. */
export async function GET(req: Request) {
  return handle(async () => {
    const { orgId } = await requireMember(req.headers)
    const rows = await listAssets(orgId)
    return Response.json({ assets: rows.map(toDTO) }, { headers: { 'Cache-Control': 'no-store' } })
  })
}
