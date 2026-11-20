/**
 * The public MediaEX API, for servers and scripts. Authenticated with an API key, never a session:
 *
 *   Authorization: Bearer mx_live_…
 *
 *   GET    /api/v1/whoami                       the key's workspace and scope                       read
 *   GET    /api/v1/assets?q=&folder=&type=&status=&tags=&date=&sort=&limit=&offset=                  read
 *   GET    /api/v1/assets/:id                                                                       read
 *   PATCH  /api/v1/assets/:id                   { title?, tags?, folderId?, metadata?, playback? }  full
 *   GET    /api/v1/assets/:id/captions          caption tracks                                      read
 *   POST   /api/v1/assets/:id/captions/generate transcribe { language? }                            full
 *   PUT    /api/v1/assets/:id/captions/:lang    upload a track { label?, text } (WebVTT or SRT)     full
 *   DELETE /api/v1/assets/:id/captions/:lang                                                        full
 *   POST   /api/v1/assets/:id/playback-token    { expiresIn? } → { token, expiresAt, embedUrl, playbackUrl }   read
 *   DELETE /api/v1/assets/:id                                                                       full
 *   POST   /api/v1/assets/:id/retry             run the pipeline again                              full
 *   POST   /api/v1/uploads                      { fileName, size, mimeType?, folderId?, presetId?, multipart? } → { asset, upload }   upload
 *   PUT    /api/v1/uploads/:id                  the file (only when upload.url points here)         upload
 *   POST   /api/v1/uploads/:id/parts            { numbers } → where to PUT each part (multipart)    upload
 *   GET    /api/v1/uploads/:id/parts            parts that have arrived, to resume (multipart)      upload
 *   PUT    /api/v1/uploads/:id/parts/:n         one part (only when its URL points here)            upload
 *   POST   /api/v1/uploads/:id/complete         queue it for processing                             upload
 *   GET    /api/v1/analytics?range=7d|30d|90d&asset=                                             read
 *   GET    /api/v1/folders                                                                          read
 *
 * Responses use the same asset shape as the dashboard, with absolute URLs. Errors are { error } with a matching status;
 * 429 comes with Retry-After. Keys are rate limited per key (API_RATE_LIMIT_PER_MINUTE, default 120).
 */
import { baseURL, pool } from '../auth.mts'
import { HttpError, apiAsset, handle } from './assets.mts'
import { searchAssets } from './asset-search.mts'
import { recovery } from './recovery.mts'
import { keyActor, requireScope } from './keys.mts'
import { captions, completeUpload, one, playbackToken, receivePart, receiveUpload, retry, startUpload, uploadParts } from './routes.mts'
import { KEY_SCOPE_LABEL, parseQuery } from './types.mts'
import { analyticsFor } from './analytics.mts'
import { listPresets } from './presets.mts'

/** Where API callers reach us: the public app origin, which forwards /api/v1 to this service. */
export const apiBase = () => (process.env.PUBLIC_API_URL ?? baseURL).replace(/\/$/, '')

const noStore = { 'Cache-Control': 'no-store' }

export function handleV1(req: Request, parts: string[]) {
  return handle(async () => {
    const a = await keyActor(req)
    const [, , area, raw, sub, extra] = parts // api, v1, area, id?, sub?, part number or caption language?
    const m = req.method
    if (parts.length > ((area === 'uploads' && sub === 'parts') || (area === 'assets' && sub === 'captions') ? 6 : 5)) throw new HttpError(404, 'Not found')
    if (area === 'uploads' && raw === 'presets' && parts.length === 4 && m === 'GET') {
      requireScope(a, 'read')
      return Response.json(await listPresets(a.orgId), { headers: noStore })
    }
    if (area === 'assets' && raw === 'trash' && parts.length === 4) return recovery(a, req, undefined, 'trash')
    let id: string | undefined
    try {
      id = raw === undefined ? undefined : decodeURIComponent(raw)
    } catch {
      throw new HttpError(400, 'Invalid ID')
    }
    if (id !== undefined && (area === 'assets' || area === 'uploads') && !/^ast_[a-z0-9]{6,20}$/.test(id)) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')

    if (area === 'whoami' && !id && m === 'GET') {
      requireScope(a, 'read')
      const { rows } = await pool.query<{ name: string; slug: string }>('select name, slug from "organization" where id = $1', [a.orgId])
      return Response.json({ workspace: { id: a.orgId, name: rows[0]?.name, slug: rows[0]?.slug }, key: { name: a.keyName, scope: a.scope, scopeLabel: KEY_SCOPE_LABEL[a.scope] } }, { headers: noStore })
    }

    if (area === 'assets') {
      if (!id && m === 'GET') {
        requireScope(a, 'read')
        const sp = new URL(req.url).searchParams
        const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 50))
        const offset = Math.max(0, Number(sp.get('offset')) || 0)
        // one extra row tells us whether there's another page
        const rows = await searchAssets(a.orgId, parseQuery(sp), limit + 1, offset)
        const more = rows.length > limit
        return Response.json({ assets: rows.slice(0, limit).map(apiAsset), limit, offset, nextOffset: more ? offset + limit : null }, { headers: noStore })
      }
      if (id && sub && ['restore','revisions'].includes(sub) && parts.length === 5) return recovery(a, req, id, sub)
      if (id && !sub) {
        requireScope(a, m === 'GET' || m === 'HEAD' ? 'read' : 'full')
        return one(a, req, id)
      }
      if (id && sub === 'retry' && m === 'POST') {
        requireScope(a, 'full')
        return retry(a, id)
      }
      if (id && sub === 'captions') {
        requireScope(a, m === 'GET' ? 'read' : 'full')
        return captions(a, req, id, extra)
      }
      if (id && sub === 'playback-token' && m === 'POST') {
        requireScope(a, 'read')
        return playbackToken(a, req, id)
      }
    }

    if (area === 'uploads') {
      requireScope(a, 'upload')
      if (!id && m === 'POST') return startUpload(a, req)
      if (id && !sub && m === 'PUT') return receiveUpload(a, req, id)
      if (id && sub === 'complete' && m === 'POST') return completeUpload(a, id)
      if (id && sub === 'parts' && extra === undefined && (m === 'GET' || m === 'POST')) return uploadParts(a, req, id)
      if (id && sub === 'parts' && extra !== undefined && m === 'PUT') return receivePart(a, req, id, Number(extra))
    }

    if (area === 'analytics' && !id && m === 'GET') {
      requireScope(a, 'read')
      return analyticsFor(a.orgId, req)
    }

    if (area === 'folders' && !id && m === 'GET') {
      requireScope(a, 'read')
      const { rows } = await pool.query<{ id: string; name: string; parentId: string | null; assetCount: number; createdAt: Date }>(
        `select f.id, f.name, f."parentId", f."createdAt", (select count(*)::int from "asset" a where a."folderId" = f.id and a."deletedAt" is null) as "assetCount"
           from "folder" f where f."organizationId" = $1 order by lower(f.name)`,
        [a.orgId],
      )
      return Response.json({ folders: rows.map((f) => ({ ...f, createdAt: new Date(f.createdAt).toISOString() })) }, { headers: noStore })
    }
    throw new HttpError(404, `No ${m} ${new URL(req.url).pathname} in the MediaEX API. See Developers in the dashboard for the endpoints.`)
  })
}
