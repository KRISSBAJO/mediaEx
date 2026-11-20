import { createHash } from 'node:crypto'
import { pool } from '../auth.mts'
import { ASSET_FIELDS, HttpError, toDTO, type AssetRow } from './assets.mts'
import { committedStorage } from './operations.mts'
import { queryParams, type SearchQuery, type WorkspaceAssetSummary } from './types.mts'

/** Escapes text for an ILIKE pattern (backslash is Postgres' default escape character). */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
const contains = (s: string) => `%${escapeLike(s)}%`

const INTERVALS = { '1d': '1 day', '7d': '7 days', '30d': '30 days', '365d': '365 days' } as const

type SortTerm = { column: string; cast: 'text' | 'timestamptz' | 'bigint' | 'real' | 'int'; asc: boolean }
const created: SortTerm = { column: 'a."createdAt"', cast: 'timestamptz', asc: false }
const id: SortTerm = { column: 'a.id', cast: 'text', asc: false }

function assetSearch(orgId: string, query: SearchQuery) {
  const where = ['a."organizationId" = $1', 'a."deletedAt" is null']
  const args: unknown[] = [orgId]
  const arg = (v: unknown) => (args.push(v), `$${args.length}`)

  const words = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
  for (const w of words) {
    const p = arg(contains(w))
    where.push(
      `(a.title ilike ${p} or a."fileName" ilike ${p} or coalesce(a."sourceInfo", '') ilike ${p} or exists (select 1 from unnest(a.tags) t where t ilike ${p})` +
        ` or exists (select 1 from jsonb_each_text(a.metadata) m where m.value ilike ${p}))`,
    )
  }
  if (query.folder === 'root') where.push('a."folderId" is null')
  else if (query.folder) where.push(`a."folderId" = ${arg(query.folder)}`)
  if (query.collection) where.push(`exists (select 1 from "collection_asset" ca where ca."assetId" = a.id and ca."collectionId" = ${arg(query.collection)})`)
  if (query.type?.length) where.push(`a.type = any(${arg(query.type)}::text[])`)
  if (query.tags?.length) where.push(`a.tags @> ${arg(query.tags)}::text[]`)
  if (query.status?.length) {
    const parts = query.status.map((s) => (s === 'ready' ? `a.status = 'ready'` : s === 'failed' ? `a.status = 'failed'` : `a.status in ('uploading', 'queued', 'processing')`))
    where.push(`(${parts.join(' or ')})`)
  }
  // dropdown fields: the value equals the option (single) or contains it (multi-select)
  for (const [field, option] of Object.entries(query.meta ?? {})) where.push(`a.metadata->${arg(field)}::text @> to_jsonb(${arg(option)}::text)`)
  if (query.date) where.push(`a."createdAt" > now() - ${arg(INTERVALS[query.date])}::interval`)
  const predicate = where.join(' and ')
  const sort = query.sort ?? (words.length ? 'relevance' : 'new')
  let terms: SortTerm[]
  switch (sort) {
    case 'old':
      terms = [{ ...created, asc: true }, { ...id, asc: true }]
      break
    case 'name':
      terms = [{ column: 'lower(a.title)', cast: 'text', asc: true }, created, id]
      break
    case 'size':
      terms = [{ column: 'a.size', cast: 'bigint', asc: false }, id]
      break
    case 'long':
      terms = [{ column: 'a.duration', cast: 'real', asc: false }, created, id]
      break
    case 'relevance': {
      if (words.length) {
        const phrase = words.join(' ')
        const rank = `case when lower(a.title) like ${arg(escapeLike(phrase) + '%')} then 0 when a.title ilike ${arg(contains(phrase))} then 1 else 2 end`
        terms = [{ column: rank, cast: 'int', asc: true }, created, id]
        break
      }
    }
    default:
      terms = [created, id]
  }
  return { predicate, args, arg, terms }
}

function ordering(terms: SortTerm[], backwards = false) {
  return terms.map(t => `${t.column} ${t.asc !== backwards ? 'asc' : 'desc'}`).join(', ')
}

/** The legacy public v1 endpoint uses offset and nextOffset. */
export async function searchAssets(orgId: string, query: SearchQuery, limit = 500, offset = 0) {
  const { predicate, args, arg, terms } = assetSearch(orgId, query)
  const { rows } = await pool.query<AssetRow>(
    `select ${ASSET_FIELDS} from "asset" a left join "user" u on u.id = a."createdBy"
     where ${predicate} order by ${ordering(terms)} limit ${arg(Math.min(1000, Math.max(1, Math.floor(limit))))} offset ${arg(Math.max(0, Math.floor(offset)))}`, args)
  return rows
}

function cursorValues(cursor: string, scope: string, terms: SortTerm[]) {
  try {
    if (cursor.length > 4096 || !/^[\w-]+$/.test(cursor)) throw new Error()
    const [filter, values] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (filter !== scope || !Array.isArray(values) || values.length !== terms.length) throw new Error()
    for (const [i, value] of values.entries()) {
      if (typeof value !== 'string' || value.length > 1024 || value.includes('\0')) throw new Error()
      switch (terms[i].cast) {
        case 'timestamptz':
          if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value) || new Date(value).toISOString() !== value.slice(0, 23) + 'Z') throw new Error()
          break
        case 'real':
          if (!/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Math.fround(Number(value)))) throw new Error()
          break
        case 'int':
          if (!/^[012]$/.test(value)) throw new Error()
          break
        case 'bigint':
          if (!/^\d{1,19}$/.test(value) || (value.length === 19 && value > '9223372036854775807')) throw new Error()
      }
    }
    return values as string[]
  } catch {
    throw new HttpError(400, 'This page link is invalid. Return to the first page.')
  }
}

export async function assetPage(orgId: string, query: SearchQuery, params: URLSearchParams) {
  const { predicate, args, arg, terms } = assetSearch(orgId, query)
  const before = params.get('before')
  const after = params.get('after')
  if (before && after) throw new HttpError(400, 'Choose one page direction.')
  const backwards = Boolean(before)
  const cursor = before || after
  const scope = createHash('sha256').update(JSON.stringify([orgId, queryParams(query).toString()])).digest('base64url').slice(0, 22)
  let boundary = ''
  if (cursor) {
    const values = cursorValues(cursor, scope, terms)
    const binds = terms.map((t, i) => `${arg(values[i])}::${t.cast}`)
    const first = terms[0]
    const comparison = first.asc !== backwards ? '>' : '<'
    if (terms.every(term => term.asc === first.asc)) {
      // PostgreSQL can seek directly to the composite index key.
      boundary = `and (${terms.map(term => term.column).join(',')}) ${comparison} (${binds.join(',')})`
    } else {
      // The secondary date and ID terms have the opposite direction to the primary name or rank.
      const rest = terms.slice(1).map(term => term.column).join(',')
      const reverse = first.asc !== backwards ? '<' : '>'
      boundary = `and ${first.column} ${comparison}= ${binds[0]} and (${first.column} ${comparison} ${binds[0]}
        or (${first.column} = ${binds[0]} and (${rest}) ${reverse} (${binds.slice(1).join(',')})))`
    }
  }
  const order = ordering(terms, backwards)
  const position = terms.map(t => t.cast === 'timestamptz'
    ? `to_char(${t.column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` : `(${t.column})::text`).join(', ')
  const limit = 50
  // Count every match, but hydrate captions, collections and creators for only this page.
  // One statement keeps counts and rows on the same PostgreSQL snapshot, including empty pages.
  type PageRow = AssetRow & { total: number; bytes: number; position: string[] }
  const { rows } = await pool.query<PageRow>(
    `with totals as (
       select count(*)::float8 total, coalesce(sum(a.size + a."outputSize"), 0)::float8 bytes
       from "asset" a where ${predicate}
     ), page as (
       select a.id, array[${position}] as position, row_number() over (order by ${order}) as seq
       from "asset" a where ${predicate} ${boundary}
       order by ${order} limit ${limit + 1}
     )
     select totals.*, page.position, ${ASSET_FIELDS} from totals left join page on true
     left join "asset" a on a.id = page.id left join "user" u on u.id = a."createdBy" order by page.seq`, args)
  const items = rows.filter(row => row.id)
  const more = items.length > limit
  const visible = items.slice(0, limit)
  if (backwards) visible.reverse()
  const token = (row: PageRow) => Buffer.from(JSON.stringify([scope, row.position])).toString('base64url')
  return {
    assets: visible.map(toDTO), total: rows[0].total, bytes: rows[0].bytes,
    previous: visible.length && (backwards ? more : Boolean(after)) ? token(visible[0]) : null,
    next: visible.length && (backwards ? Boolean(before) : more) ? token(visible[visible.length - 1]) : null,
  }
}

export async function workspaceAssetSummary(orgId: string): Promise<WorkspaceAssetSummary> {
  const visibleSummary = pool.query<Omit<WorkspaceAssetSummary, 'committedBytes'>>(
    `select count(*)::float8 total, count(*) filter (where "folderId" is null)::float8 unfiled,
       count(*) filter (where status <> 'uploading')::float8 uploaded,
       count(*) filter (where status in ('uploading','queued','processing'))::float8 active,
       count(*) filter (where status = 'failed')::float8 failed,
       count(*) filter (where moderation = 'pending')::float8 pending,
       coalesce(sum(size + "outputSize"), 0)::float8 bytes,
       count(*) filter (where type = 'video')::float8 video, count(*) filter (where type = 'audio')::float8 audio,
       count(*) filter (where type = 'image')::float8 image
     from "asset" where "organizationId" = $1 and "deletedAt" is null`, [orgId])
  const [storageBytes, { rows }] = await Promise.all([committedStorage(orgId), visibleSummary])
  return { ...rows[0], committedBytes: storageBytes }
}

