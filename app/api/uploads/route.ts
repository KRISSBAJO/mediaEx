import { pool } from '@/lib/auth'
import { MAX_UPLOAD_BYTES, getAssetRow, handle, HttpError, newAssetId, requireMember, toDTO } from '@/lib/media/assets'
import { storage } from '@/lib/media/storage'
import { guessType } from '@/lib/media/types'

/**
 * Start an upload: creates the asset (status "uploading") and returns where to PUT the file.
 * Body: { fileName, size, mimeType }
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { user, orgId } = await requireMember(req.headers)
    const body = (await req.json().catch(() => null)) as { fileName?: unknown; size?: unknown; mimeType?: unknown } | null
    const fileName = typeof body?.fileName === 'string' ? body.fileName.trim().slice(0, 255) : ''
    const size = typeof body?.size === 'number' ? Math.floor(body.size) : 0
    const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.slice(0, 120) : null
    if (!fileName) throw new HttpError(400, 'The file needs a name.')
    if (size <= 0) throw new HttpError(400, `${fileName} is empty.`)
    if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, `${fileName} is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 ** 3)} GB limit.`)
    const type = guessType(fileName, mimeType)
    if (!type) throw new HttpError(415, `${fileName} isn’t a video, audio or image file MediaEX can process.`)

    const id = newAssetId()
    const ext = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1]?.toLowerCase()
    const originalKey = `${orgId}/${id}/original${ext ? `.${ext}` : ''}`
    const title = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || fileName

    await pool.query(
      `insert into "asset" (id, "organizationId", "createdBy", title, type, status, "fileName", "mimeType", size, "originalKey")
       values ($1, $2, $3, $4, $5, 'uploading', $6, $7, $8, $9)`,
      [id, orgId, user.id, title, type, fileName, mimeType, size, originalKey],
    )
    const row = await getAssetRow(id, orgId)
    return Response.json({ asset: toDTO(row!), upload: await storage().uploadTarget(originalKey, id) }, { status: 201 })
  })
}
