/**
 * The public MediaEX API, for servers and scripts. Authenticated with an API key, never a session:
 *
 *   Authorization: Bearer mx_live_…
 *
 *   GET    /api/v1/whoami                       the key's workspace and scope                       read
 *   GET    /api/v1/assets?q=&folder=&type=&status=&tags=&date=&sort=&limit=&offset=                  read
 *   GET    /api/v1/assets/:id                                                                       read
 *   PATCH  /api/v1/assets/:id                   { title?, tags?, folderId?, metadata? }             full
 *   DELETE /api/v1/assets/:id                                                                       full
 *   POST   /api/v1/assets/:id/retry             run the pipeline again                              full
 *   POST   /api/v1/uploads                      { fileName, size, mimeType?, folderId? } → { asset, upload }   upload
 *   PUT    /api/v1/uploads/:id                  the file (only when upload.url points here)         upload
 *   POST   /api/v1/uploads/:id/complete         queue it for processing                             upload
 *   GET    /api/v1/folders                                                                          read
 *
 * Responses use the same asset shape as the dashboard, with absolute URLs. Errors are { error } with a matching status;
 * 429 comes with Retry-After. Keys are rate limited per key (API_RATE_LIMIT_PER_MINUTE, default 120).
 */
import { baseURL, pool } from '../auth.mts'
import { HttpError, apiAsset, handle, searchAssets } from './assets.mts'
import { keyActor, requireScope } from './keys.mts'
import { completeUpload, one, receiveUpload, retry, startUpload } from './routes.mts'
import { KEY_SCOPE_LABEL, parseQuery } from './types.mts'

/** Where API callers reach us: the public app origin, which forwards /api/v1 to this service. */
export const apiBase = () => (process.env.PUBLIC_API_URL ?? baseURL).replace(/\/$/, '')

const noStore = { 'Cache-Control': 'no-store' }

export function handleV1(req: Request, parts: string[]) {
  return handle(async () => {
    const a = await keyActor(req)
    const [, , area, raw, sub] = parts // api, v1, area, id?, sub?
    const m = req.method
    if (parts.length > 5) throw new HttpError(404, 'Not found')
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
      if (id && !sub) {
        requireScope(a, m === 'GET' || m === 'HEAD' ? 'read' : 'full')
        return one(a, req, id)
      }
      if (id && sub === 'retry' && m === 'POST') {
        requireScope(a, 'full')
        return retry(a, id)
      }
    }

    if (area === 'uploads') {
      requireScope(a, 'upload')
      if (!id && m === 'POST') return startUpload(a, req)
      if (id && !sub && m === 'PUT') return receiveUpload(a, req, id)
      if (id && sub === 'complete' && m === 'POST') return completeUpload(a, id)
    }

    if (area === 'folders' && !id && m === 'GET') {
      requireScope(a, 'read')
      const { rows } = await pool.query<{ id: string; name: string; parentId: string | null; assetCount: number; createdAt: Date }>(
        `select f.id, f.name, f."parentId", f."createdAt", (select count(*)::int from "asset" a where a."folderId" = f.id) as "assetCount"
           from "folder" f where f."organizationId" = $1 order by lower(f.name)`,
        [a.orgId],
      )
      return Response.json({ folders: rows.map((f) => ({ ...f, createdAt: new Date(f.createdAt).toISOString() })) }, { headers: noStore })
    }
    throw new HttpError(404, `No ${m} ${new URL(req.url).pathname} in the MediaEX API. See Developers in the dashboard for the endpoints.`)
  })
}
