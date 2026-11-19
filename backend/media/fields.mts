/**
 * Custom metadata: each workspace defines its own fields, and assets carry values for them.
 *
 *   GET    /api/fields                       every field, in order (any member)
 *   POST   /api/fields                       { label, type, options?, required?, help? }      owners and admins
 *   PATCH  /api/fields/:id                   { label?, options?, required?, help? }           owners and admins
 *   DELETE /api/fields/:id                   also removes its values from every asset         owners and admins
 *   POST   /api/fields/reorder               { ids }                                           owners and admins
 *
 * Values live in asset.metadata as { [fieldId]: value }, so renaming a field never touches the data.
 */
import { randomBytes } from 'node:crypto'
import { pool } from '../auth.mts'
import { HttpError, requireMember } from './assets.mts'
import { FIELD_TYPES, type FieldType, type MetadataField } from './types.mts'

const newId = () => `mdf_${randomBytes(9).toString('base64url').replace(/[-_]/g, '').slice(0, 12).toLowerCase()}`
const MAX_FIELDS = 40
const MAX_OPTIONS = 100

type Row = { id: string; key: string; label: string; type: FieldType; options: string[]; required: boolean; help: string | null; position: number }

export async function listFields(orgId: string): Promise<MetadataField[]> {
  const { rows } = await pool.query<Row>('select id, key, label, type, options, required, help, position from "metadata_field" where "organizationId" = $1 order by position, "createdAt"', [orgId])
  return rows.map((r) => ({ id: r.id, key: r.key, label: r.label, type: r.type, options: r.options ?? [], required: r.required, help: r.help }))
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'field'

function cleanOptions(v: unknown, type: FieldType) {
  if (type !== 'select' && type !== 'multiselect') return []
  if (!Array.isArray(v)) throw new HttpError(400, 'Dropdown fields need a list of options.')
  const opts = [...new Set(v.filter((o): o is string => typeof o === 'string').map((o) => o.trim().slice(0, 60)).filter(Boolean))]
  if (!opts.length) throw new HttpError(400, 'Add at least one option.')
  if (opts.length > MAX_OPTIONS) throw new HttpError(400, `Use up to ${MAX_OPTIONS} options.`)
  return opts
}

function cleanLabel(v: unknown) {
  const label = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  if (!label || label.length > 60) throw new HttpError(400, 'Field names need 1–60 characters.')
  return label
}

async function requireManager(headers: Headers) {
  const m = await requireMember(headers)
  if (m.role !== 'owner' && m.role !== 'admin') throw new HttpError(403, 'Only owners and admins can change metadata fields.')
  return m
}

/** Checks one value against its field; returns the value to store, or undefined to remove it. */
export function validateValue(field: MetadataField, value: unknown): unknown {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
    if (field.required) throw new HttpError(400, `${field.label} is required.`)
    return undefined
  }
  switch (field.type) {
    case 'text':
    case 'longtext': {
      if (typeof value !== 'string') throw new HttpError(400, `${field.label} must be text.`)
      const max = field.type === 'text' ? 500 : 5000
      if (value.length > max) throw new HttpError(400, `${field.label} can be up to ${max} characters.`)
      return value.trim()
    }
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
      if (!Number.isFinite(n)) throw new HttpError(400, `${field.label} must be a number.`)
      return n
    }
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new HttpError(400, `${field.label} must be a date (YYYY-MM-DD).`)
      return value
    }
    case 'select': {
      if (typeof value !== 'string' || !field.options.includes(value)) throw new HttpError(400, `${field.label} must be one of: ${field.options.join(', ')}.`)
      return value
    }
    case 'multiselect': {
      const arr = Array.isArray(value) ? value : [value]
      if (!arr.every((x) => typeof x === 'string' && field.options.includes(x))) throw new HttpError(400, `${field.label} only accepts: ${field.options.join(', ')}.`)
      return [...new Set(arr as string[])]
    }
  }
}

/** Merges a patch of { fieldId: value } into existing metadata, validating every touched field. */
export async function mergeMetadata(orgId: string, current: Record<string, unknown>, patch: unknown) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'metadata must be an object of { fieldId: value }.')
  const fields = await listFields(orgId)
  const byId = new Map(fields.map((f) => [f.id, f]))
  const next = { ...current }
  for (const [id, value] of Object.entries(patch as Record<string, unknown>)) {
    const f = byId.get(id) ?? fields.find((x) => x.key === id) // accept the field's key too, handy for API users
    if (!f) throw new HttpError(400, `Unknown metadata field “${id}”.`)
    const v = validateValue(f, value)
    if (v === undefined) delete next[f.id]
    else next[f.id] = v
  }
  return next
}

export async function handleFields(req: Request, id?: string) {
  if (!id && req.method === 'GET') {
    const { orgId } = await requireMember(req.headers)
    return Response.json({ fields: await listFields(orgId) }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const { orgId } = await requireManager(req.headers)
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>

  if (!id && req.method === 'POST') {
    const label = cleanLabel(body.label)
    const type = body.type as FieldType
    if (!FIELD_TYPES.includes(type)) throw new HttpError(400, `type must be one of: ${FIELD_TYPES.join(', ')}.`)
    const existing = await listFields(orgId)
    if (existing.length >= MAX_FIELDS) throw new HttpError(400, `A workspace can have up to ${MAX_FIELDS} fields.`)
    let key = slug(label)
    for (let i = 2; existing.some((f) => f.key === key); i++) key = `${slug(label)}_${i}`
    await pool.query(
      `insert into "metadata_field" (id, "organizationId", key, label, type, options, required, help, position) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [newId(), orgId, key, label, type, JSON.stringify(cleanOptions(body.options, type)), body.required === true, typeof body.help === 'string' ? body.help.trim().slice(0, 200) || null : null, existing.length],
    )
    return Response.json({ fields: await listFields(orgId) }, { status: 201 })
  }

  if (id === 'reorder' && req.method === 'POST') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []
    await pool.query(
      `update "metadata_field" f set position = o.n from unnest($2::text[]) with ordinality as o(id, n) where f.id = o.id and f."organizationId" = $1`,
      [orgId, ids],
    )
    return Response.json({ fields: await listFields(orgId) })
  }

  if (!id) throw new HttpError(405, 'Method not allowed')
  const field = (await listFields(orgId)).find((f) => f.id === id)
  if (!field) throw new HttpError(404, 'That field doesn’t exist.')

  if (req.method === 'PATCH') {
    const label = body.label === undefined ? field.label : cleanLabel(body.label)
    const options = body.options === undefined ? field.options : cleanOptions(body.options, field.type)
    const required = body.required === undefined ? field.required : body.required === true
    const help = body.help === undefined ? field.help : typeof body.help === 'string' ? body.help.trim().slice(0, 200) || null : null
    await pool.query('update "metadata_field" set label = $2, options = $3, required = $4, help = $5 where id = $1', [id, label, JSON.stringify(options), required, help])
    // values for options that no longer exist are removed
    const removed = field.options.filter((o) => !options.includes(o))
    if (removed.length && field.type === 'select') {
      await pool.query(`update "asset" set metadata = metadata - $2 where "organizationId" = $1 and metadata->>$2 = any($3::text[])`, [orgId, id, removed])
    }
    if (removed.length && field.type === 'multiselect') {
      await pool.query(
        `update "asset" set metadata = jsonb_set(metadata, array[$2], coalesce((select jsonb_agg(v) from jsonb_array_elements_text(metadata->$2) v where v <> all($3::text[])), '[]'::jsonb))
          where "organizationId" = $1 and metadata ? $2`,
        [orgId, id, removed],
      )
    }
    return Response.json({ fields: await listFields(orgId) })
  }

  if (req.method === 'DELETE') {
    await pool.query('delete from "metadata_field" where id = $1', [id])
    await pool.query(`update "asset" set metadata = metadata - $2 where "organizationId" = $1 and metadata ? $2`, [orgId, id])
    return Response.json({ fields: await listFields(orgId) })
  }
  throw new HttpError(405, 'Method not allowed')
}
