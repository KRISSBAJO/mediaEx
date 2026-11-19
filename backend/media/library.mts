/**
 * Library organisation API (backend): folders, collections, tags, saved searches and bulk actions.
 *
 *   GET    /api/folders                      every folder in the workspace, with asset counts
 *   POST   /api/folders                      { name, parentId? }
 *   PATCH  /api/folders/:id                  { name?, parentId? } (rename or move; never into itself)
 *   DELETE /api/folders/:id                  its assets and subfolders move up to its parent
 *   GET    /api/collections                  with asset counts and a cover
 *   POST   /api/collections                  { name, description? }
 *   PATCH  /api/collections/:id              { name?, description? }
 *   DELETE /api/collections/:id              the assets stay where they are
 *   POST   /api/collections/:id/add          { ids }
 *   POST   /api/collections/:id/remove       { ids }
 *   GET    /api/tags                         every tag in use, with counts
 *   GET    /api/searches                     your saved searches in this workspace
 *   POST   /api/searches                     { name, query }
 *   DELETE /api/searches/:id
 *   POST   /api/assets/bulk                  { ids, action: move | tag | untag | delete, folderId?, tags? }
 */
import { randomBytes } from 'node:crypto'
import { pool } from '../auth.mts'
import { HttpError, prefixOf, requireMember } from './assets.mts'
import { storage } from './storage.mts'
import { normaliseTag, parseQuery, queryParams, type Collection, type Folder, type SavedSearch, type SearchQuery } from './types.mts'

const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url').replace(/[-_]/g, '').slice(0, 12).toLowerCase()}`
const ID = /^[a-z]{3}_[a-z0-9]{4,24}$/

async function body<T>(req: Request) {
  return ((await req.json().catch(() => null)) ?? {}) as Partial<T>
}

function cleanName(v: unknown, what: string) {
  const name = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  if (!name || name.length > 80) throw new HttpError(400, `${what} names need 1–80 characters.`)
  if (/[/\\]/.test(name)) throw new HttpError(400, `${what} names can’t contain slashes.`)
  return name
}

function cleanIds(v: unknown) {
  if (!Array.isArray(v)) throw new HttpError(400, 'Send a list of asset IDs.')
  const ids = [...new Set(v.filter((x): x is string => typeof x === 'string' && /^ast_[a-z0-9]{6,20}$/.test(x)))]
  if (!ids.length) throw new HttpError(400, 'No assets were selected.')
  if (ids.length > 500) throw new HttpError(400, 'Select up to 500 assets at a time.')
  return ids
}

/** Postgres unique-violation → a friendly conflict. */
async function unique<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new HttpError(409, message)
    throw e
  }
}

/* ------------------------------------------------ folders */
async function listFolders(orgId: string): Promise<Folder[]> {
  const { rows } = await pool.query<{ id: string; name: string; parentId: string | null; createdAt: Date; assetCount: string }>(
    `select f.id, f.name, f."parentId", f."createdAt", count(a.id) as "assetCount"
       from "folder" f left join "asset" a on a."folderId" = f.id
      where f."organizationId" = $1
      group by f.id order by lower(f.name)`,
    [orgId],
  )
  return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parentId, assetCount: Number(r.assetCount), createdAt: new Date(r.createdAt).toISOString() }))
}

async function assertFolder(orgId: string, id: string | null | undefined) {
  if (!id) return null
  if (!ID.test(id)) throw new HttpError(404, 'That folder doesn’t exist.')
  const { rows } = await pool.query('select id from "folder" where id = $1 and "organizationId" = $2', [id, orgId])
  if (!rows[0]) throw new HttpError(404, 'That folder doesn’t exist.')
  return id
}

async function folders(req: Request, id?: string) {
  const { orgId, user } = await requireMember(req.headers)
  if (!id && req.method === 'GET') return Response.json({ folders: await listFolders(orgId) }, { headers: { 'Cache-Control': 'no-store' } })

  if (!id && req.method === 'POST') {
    const b = await body<{ name: unknown; parentId: unknown }>(req)
    const name = cleanName(b.name, 'Folder')
    const parentId = await assertFolder(orgId, typeof b.parentId === 'string' ? b.parentId : null)
    const fid = newId('fld')
    await unique(
      () => pool.query('insert into "folder" (id, "organizationId", "parentId", name, "createdBy") values ($1, $2, $3, $4, $5)', [fid, orgId, parentId, name, user.id]),
      `There’s already a folder called “${name}” here.`,
    )
    return Response.json({ folder: (await listFolders(orgId)).find((f) => f.id === fid) }, { status: 201 })
  }

  if (!id) throw new HttpError(405, 'Method not allowed')
  await assertFolder(orgId, id)

  if (req.method === 'PATCH') {
    const b = await body<{ name: unknown; parentId: unknown }>(req)
    if (b.name !== undefined) {
      const name = cleanName(b.name, 'Folder')
      await unique(() => pool.query('update "folder" set name = $2 where id = $1', [id, name]), `There’s already a folder called “${name}” here.`)
    }
    if (b.parentId !== undefined) {
      const parentId = await assertFolder(orgId, typeof b.parentId === 'string' ? b.parentId : null)
      if (parentId) {
        // a folder can't move into itself or anything inside it
        const { rows } = await pool.query(
          `with recursive up as (select id, "parentId" from "folder" where id = $1
             union all select f.id, f."parentId" from "folder" f join up on f.id = up."parentId")
           select 1 from up where id = $2`,
          [parentId, id],
        )
        if (rows.length) throw new HttpError(400, 'A folder can’t go inside itself.')
      }
      await unique(() => pool.query('update "folder" set "parentId" = $2 where id = $1', [id, parentId]), 'A folder with that name already exists there.')
    }
    return Response.json({ folders: await listFolders(orgId) })
  }

  if (req.method === 'DELETE') {
    // nothing is lost: assets and subfolders move up to the deleted folder's parent
    const client = await pool.connect()
    try {
      await client.query('begin')
      const { rows } = await client.query<{ parentId: string | null }>('select "parentId" from "folder" where id = $1 for update', [id])
      const parent = rows[0]?.parentId ?? null
      await client.query('update "asset" set "folderId" = $2, "updatedAt" = now() where "folderId" = $1', [id, parent])
      const { rows: kids } = await client.query<{ id: string; name: string }>('select id, name from "folder" where "parentId" = $1', [id])
      for (const k of kids) {
        // if the parent already has a folder with the same name, keep both by suffixing the moved one
        const { rows: clash } = await client.query(
          'select 1 from "folder" where "organizationId" = $1 and coalesce("parentId", \'\') = coalesce($2, \'\') and lower(name) = lower($3) and id <> $4',
          [orgId, parent, k.name, k.id],
        )
        await client.query('update "folder" set "parentId" = $2, name = $3 where id = $1', [k.id, parent, clash.length ? `${k.name} (moved)` : k.name])
      }
      await client.query('delete from "folder" where id = $1', [id])
      await client.query('commit')
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
    return Response.json({ folders: await listFolders(orgId) })
  }
  throw new HttpError(405, 'Method not allowed')
}

/* ------------------------------------------------ collections */
async function listCollections(orgId: string): Promise<Collection[]> {
  const { rows } = await pool.query<{ id: string; name: string; description: string | null; updatedAt: Date; assetCount: string; coverId: string | null; coverOrg: string | null; coverThumb: string | null }>(
    `select c.id, c.name, c.description, c."updatedAt", count(ca."assetId") as "assetCount",
            (select a.id from "collection_asset" x join "asset" a on a.id = x."assetId" where x."collectionId" = c.id and a."thumbKey" is not null order by x."addedAt" desc limit 1) as "coverId",
            (select a."thumbKey" from "collection_asset" x join "asset" a on a.id = x."assetId" where x."collectionId" = c.id and a."thumbKey" is not null order by x."addedAt" desc limit 1) as "coverThumb"
       from "collection" c left join "collection_asset" ca on ca."collectionId" = c.id
      where c."organizationId" = $1
      group by c.id order by lower(c.name)`,
    [orgId],
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    assetCount: Number(r.assetCount),
    coverUrl: r.coverId && r.coverThumb ? `/api/media/${r.coverId}/${r.coverThumb.split('/').pop()}` : null,
    updatedAt: new Date(r.updatedAt).toISOString(),
  }))
}

async function assertCollection(orgId: string, id: string) {
  if (!ID.test(id)) throw new HttpError(404, 'That collection doesn’t exist.')
  const { rows } = await pool.query('select id from "collection" where id = $1 and "organizationId" = $2', [id, orgId])
  if (!rows[0]) throw new HttpError(404, 'That collection doesn’t exist.')
}

/** Only assets of this workspace, so nobody can add someone else's asset to a collection. */
async function ownIds(orgId: string, ids: string[]) {
  const { rows } = await pool.query<{ id: string }>('select id from "asset" where "organizationId" = $1 and id = any($2::text[])', [orgId, ids])
  return rows.map((r) => r.id)
}

async function collections(req: Request, id?: string, sub?: string) {
  const { orgId, user } = await requireMember(req.headers)
  if (!id && req.method === 'GET') return Response.json({ collections: await listCollections(orgId) }, { headers: { 'Cache-Control': 'no-store' } })

  if (!id && req.method === 'POST') {
    const b = await body<{ name: unknown; description: unknown }>(req)
    const name = cleanName(b.name, 'Collection')
    const description = typeof b.description === 'string' ? b.description.trim().slice(0, 300) || null : null
    const cid = newId('col')
    await unique(
      () => pool.query('insert into "collection" (id, "organizationId", name, description, "createdBy") values ($1, $2, $3, $4, $5)', [cid, orgId, name, description, user.id]),
      `There’s already a collection called “${name}”.`,
    )
    return Response.json({ collection: (await listCollections(orgId)).find((c) => c.id === cid) }, { status: 201 })
  }

  if (!id) throw new HttpError(405, 'Method not allowed')
  await assertCollection(orgId, id)

  if (sub === 'add' || sub === 'remove') {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')
    const ids = await ownIds(orgId, cleanIds((await body<{ ids: unknown }>(req)).ids))
    if (sub === 'add') {
      await pool.query(`insert into "collection_asset" ("collectionId", "assetId") select $1, unnest($2::text[]) on conflict do nothing`, [id, ids])
    } else {
      await pool.query(`delete from "collection_asset" where "collectionId" = $1 and "assetId" = any($2::text[])`, [id, ids])
    }
    await pool.query('update "collection" set "updatedAt" = now() where id = $1', [id])
    return Response.json({ collection: (await listCollections(orgId)).find((c) => c.id === id), changed: ids.length })
  }
  if (sub) throw new HttpError(404, 'Not found')

  if (req.method === 'PATCH') {
    const b = await body<{ name: unknown; description: unknown }>(req)
    if (b.name !== undefined) {
      const name = cleanName(b.name, 'Collection')
      await unique(() => pool.query('update "collection" set name = $2, "updatedAt" = now() where id = $1', [id, name]), `There’s already a collection called “${name}”.`)
    }
    if (b.description !== undefined) {
      const description = typeof b.description === 'string' ? b.description.trim().slice(0, 300) || null : null
      await pool.query('update "collection" set description = $2, "updatedAt" = now() where id = $1', [id, description])
    }
    return Response.json({ collection: (await listCollections(orgId)).find((c) => c.id === id) })
  }
  if (req.method === 'DELETE') {
    await pool.query('delete from "collection" where id = $1', [id])
    return new Response(null, { status: 204 })
  }
  throw new HttpError(405, 'Method not allowed')
}

/* ------------------------------------------------ tags */
async function tags(req: Request) {
  const { orgId } = await requireMember(req.headers)
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed')
  const { rows } = await pool.query<{ tag: string; count: string }>(
    `select t as tag, count(*) as count from "asset", unnest(tags) t where "organizationId" = $1 group by t order by count(*) desc, t limit 500`,
    [orgId],
  )
  return Response.json({ tags: rows.map((r) => ({ tag: r.tag, count: Number(r.count) })) }, { headers: { 'Cache-Control': 'no-store' } })
}

/* ------------------------------------------------ saved searches (per person, per workspace) */
async function searches(req: Request, id?: string) {
  const { orgId, user } = await requireMember(req.headers)
  const list = async (): Promise<SavedSearch[]> => {
    const { rows } = await pool.query<{ id: string; name: string; query: SearchQuery; createdAt: Date }>(
      'select id, name, query, "createdAt" from "saved_search" where "organizationId" = $1 and "userId" = $2 order by "createdAt"',
      [orgId, user.id],
    )
    return rows.map((r) => ({ id: r.id, name: r.name, query: r.query, createdAt: new Date(r.createdAt).toISOString() }))
  }
  if (!id && req.method === 'GET') return Response.json({ searches: await list() }, { headers: { 'Cache-Control': 'no-store' } })
  if (!id && req.method === 'POST') {
    const b = await body<{ name: unknown; query: unknown }>(req)
    const name = cleanName(b.name, 'Search')
    // round-trip through the URL form so only known, valid filters are stored
    const raw = b.query && typeof b.query === 'object' ? (b.query as Record<string, unknown>) : {}
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' || Array.isArray(v)) params.set(k, Array.isArray(v) ? v.join(',') : v)
    const query = parseQuery(queryParams(parseQuery(params)))
    const { rows } = await pool.query('select count(*)::int as n from "saved_search" where "organizationId" = $1 and "userId" = $2', [orgId, user.id])
    if (rows[0].n >= 30) throw new HttpError(400, 'You can keep up to 30 saved searches. Delete one first.')
    const sid = newId('srh')
    await pool.query('insert into "saved_search" (id, "organizationId", "userId", name, query) values ($1, $2, $3, $4, $5)', [sid, orgId, user.id, name, JSON.stringify(query)])
    return Response.json({ searches: await list() }, { status: 201 })
  }
  if (id && req.method === 'DELETE') {
    if (!ID.test(id)) throw new HttpError(404, 'Not found')
    await pool.query('delete from "saved_search" where id = $1 and "organizationId" = $2 and "userId" = $3', [id, orgId, user.id])
    return Response.json({ searches: await list() })
  }
  throw new HttpError(405, 'Method not allowed')
}

/* ------------------------------------------------ bulk actions on assets */
export async function bulk(req: Request) {
  const { orgId } = await requireMember(req.headers)
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')
  const b = await body<{ ids: unknown; action: unknown; folderId: unknown; tags: unknown }>(req)
  const ids = await ownIds(orgId, cleanIds(b.ids))
  if (!ids.length) throw new HttpError(404, 'None of those assets are in this workspace.')

  if (b.action === 'move') {
    const folderId = await assertFolder(orgId, typeof b.folderId === 'string' ? b.folderId : null)
    await pool.query('update "asset" set "folderId" = $2, "updatedAt" = now() where id = any($1::text[])', [ids, folderId])
    return Response.json({ changed: ids.length })
  }
  if (b.action === 'tag' || b.action === 'untag') {
    const tags = Array.isArray(b.tags) ? [...new Set(b.tags.filter((t): t is string => typeof t === 'string').map(normaliseTag).filter(Boolean))] : []
    if (!tags.length) throw new HttpError(400, 'Name at least one tag.')
    if (b.action === 'tag') {
      // add without duplicates, and keep within the 20-tag limit per asset
      await pool.query(
        `update "asset" set tags = (select array(select distinct t from unnest(tags || $2::text[]) t limit 20)), "updatedAt" = now() where id = any($1::text[])`,
        [ids, tags],
      )
    } else {
      await pool.query(`update "asset" set tags = (select array(select t from unnest(tags) t where t <> all($2::text[]))), "updatedAt" = now() where id = any($1::text[])`, [ids, tags])
    }
    return Response.json({ changed: ids.length })
  }
  if (b.action === 'delete') {
    const { rows } = await pool.query<{ id: string; organizationId: string }>('delete from "asset" where id = any($1::text[]) returning id, "organizationId"', [ids])
    const store = storage()
    for (let i = 0; i < rows.length; i += 5) await Promise.all(rows.slice(i, i + 5).map((r) => store.removePrefix(prefixOf(r))))
    return Response.json({ changed: rows.length })
  }
  throw new HttpError(400, 'Unknown action.')
}

/* ------------------------------------------------ router */
export function handleLibrary(req: Request, parts: string[]) {
  const [, area, id, sub] = parts // ['api', area, id?, sub?]
  if (parts.length > 4) throw new HttpError(404, 'Not found')
  if (area === 'folders' && !sub) return folders(req, id)
  if (area === 'collections') return collections(req, id, sub)
  if (area === 'tags' && !id) return tags(req)
  if (area === 'searches' && !sub) return searches(req, id)
  throw new HttpError(404, 'Not found')
}
