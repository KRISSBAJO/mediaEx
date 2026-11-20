/**
 * Retention rules: "move videos in Drafts to Trash 90 days after upload", "… when nobody has played them for 180 days".
 *
 *   GET    /api/assets/retention              rules and recent activity (any member)
 *   POST   /api/assets/retention              create a rule                       (owners and admins)
 *   POST   /api/assets/retention/preview      what a draft rule matches right now (owners and admins)
 *   PUT    /api/assets/retention/:id          replace a rule                      (owners and admins)
 *   DELETE /api/assets/retention/:id          delete a rule                       (owners and admins)
 *   POST   /api/assets/retention/:id/run      apply a rule now                    (owners and admins)
 *
 * A rule never deletes anything itself. Matching media goes to Trash through trashAssets, so it can be restored
 * for 30 days, emits asset.deleted webhooks and appears in each asset's history as "rule:<id>". Media that is
 * uploading, encoding or under a site-admin takedown is never matched. The maintenance loop applies each enabled
 * rule at most once an hour, moving up to MAX_PER_RUN assets per pass.
 */
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '../auth.mts'
import { HttpError, requireMember } from './assets.mts'
import type { Actor } from './keys.mts'
import { trashAssets } from './recovery.mts'
import { normaliseTag, type MediaType, type RetentionDraft, type RetentionPreview, type RetentionRule } from './types.mts'

const RULE_ID = /^rtn_[0-9a-f]{32}$/
const KINDS: MediaType[] = ['image', 'video', 'audio']
const MAX_RULES = 25
const MAX_PER_RUN = 500
const headers = { 'Cache-Control': 'private, no-store' }
type Database = Pick<PoolClient, 'query'>

export function parseRetention(input: unknown): RetentionDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Expected a retention rule.')
  const d = input as Record<string, unknown>
  const name = typeof d.name === 'string' ? d.name.trim() : ''
  if (!name || name.length > 80) throw new HttpError(400, 'Rule names must be 1–80 characters.')
  if (typeof d.enabled !== 'boolean' || typeof d.includeSubfolders !== 'boolean') throw new HttpError(400, 'Specify whether the rule is on and whether it covers subfolders.')
  const folderId = d.folderId ?? null
  if (folderId !== null && (typeof folderId !== 'string' || !/^fld_[a-z0-9]{4,24}$/.test(folderId))) throw new HttpError(400, 'Invalid folder.')
  if (!Array.isArray(d.kinds) || !d.kinds.length || !d.kinds.every(k => KINDS.includes(k))) throw new HttpError(400, 'Select one or more media types.')
  const tag = d.tag == null || d.tag === '' ? null : typeof d.tag === 'string' ? normaliseTag(d.tag) : ''
  if (tag === '') throw new HttpError(400, 'Invalid tag.')
  if (d.basis !== 'created' && d.basis !== 'unplayed') throw new HttpError(400, 'Choose when the rule applies.')
  if (typeof d.days !== 'number' || !Number.isSafeInteger(d.days) || d.days < 1 || d.days > 3650) throw new HttpError(400, 'Days must be a whole number from 1 to 3650.')
  return { name, enabled: d.enabled, folderId, includeSubfolders: d.includeSubfolders, kinds: [...new Set<MediaType>(d.kinds)], tag, basis: d.basis, days: d.days }
}

/** The assets a rule matches, oldest first. Parameters: $1 workspace, then the rule's scope and condition. */
const MATCH = `
  with recursive scope(id) as (
    select id from folder where id = $2 and "organizationId" = $1
    union all
    select f.id from folder f join scope s on f."parentId" = s.id where $3
  )
  select a.id, a.title, a.type, (a.size + coalesce(a."outputSize", 0))::float8 as bytes from asset a
  where a."organizationId" = $1 and a."deletedAt" is null and a.status in ('ready', 'failed') and a."takenDown" is null
    and a.type = any($4::text[])
    and ($2::text is null or a."folderId" in (select id from scope))
    and ($5::text is null or $5 = any(a.tags))
    and a."createdAt" < now() - make_interval(days => $6)
    and ($7 <> 'unplayed' or not exists (
      select 1 from view_session v where v."assetId" = a.id and v."startedAt" >= now() - make_interval(days => $6)))
  order by a."createdAt", a.id`
const matchValues = (orgId: string, r: RetentionDraft) => [orgId, r.folderId, r.includeSubfolders, r.kinds, r.tag, r.days, r.basis]

export async function previewRetention(orgId: string, rule: RetentionDraft, db: Database = pool): Promise<RetentionPreview> {
  const { rows: [row] } = await db.query<RetentionPreview>(`
    select count(*)::int as count, coalesce(sum(bytes), 0)::float8 as bytes,
      coalesce((array_agg(jsonb_build_object('id', id, 'title', title, 'type', type)))[1:5], '{}') as samples
    from (${MATCH}) m`, matchValues(orgId, rule))
  return row
}

const columns = `id, name, enabled, "folderId", "includeSubfolders", kinds, tag, basis, days, "lastRunAt", "lastMoved",
  "totalMoved"::float8 as "totalMoved", "createdAt", "updatedAt"`

/** Move one rule's matches to Trash, one asset at a time so a single busy asset never blocks the rest. */
async function apply(orgId: string, rule: RetentionRule, actorId: string | null) {
  const { rows } = await pool.query<{ id: string }>(MATCH + ` limit ${MAX_PER_RUN}`, matchValues(orgId, rule))
  const actor: Actor = { orgId, userId: actorId, role: 'owner', via: 'session', scope: 'full', label: 'rule:' + rule.id }
  let moved = 0
  for (const { id } of rows) {
    try {
      moved += await trashAssets(actor, [id])
    } catch {
      // Started encoding or captions since the match. The next pass picks it up.
    }
  }
  await pool.query(`update retention_rule set "lastRunAt" = now(), "lastMoved" = $2::int, "totalMoved" = "totalMoved" + $2::int where id = $1`, [rule.id, moved])
  if (moved || actorId) {
    await pool.query(`insert into retention_rule_event ("organizationId", "ruleId", name, action, "actorId", moved) values ($1, $2, $3, $4, $5, $6)`,
      [orgId, rule.id, rule.name, actorId ? 'ran manually' : 'ran', actorId, moved])
  }
  return moved
}

/** Called by the maintenance loop. Claiming a rule stamps lastRunAt first, so two API instances never apply the same rule at once. */
export async function applyRetentionRules() {
  const { rows } = await pool.query<RetentionRule & { organizationId: string }>(`
    update retention_rule set "lastRunAt" = now() where id in (
      select id from retention_rule where enabled and ("lastRunAt" is null or "lastRunAt" <= now() - interval '1 hour')
      order by "lastRunAt" nulls first, id limit 20 for update skip locked)
    returning "organizationId", ${columns}`)
  for (const rule of rows) {
    try {
      await apply(rule.organizationId, rule, null)
    } catch {
      console.warn('[media maintenance] A retention rule could not be applied. It will retry in an hour.', rule.id)
    }
  }
}

export async function handleRetention(req: Request, parts: string[]) {
  // parts: ['api', 'assets', 'retention', id?, 'run'?]
  const { orgId, role, user } = await requireMember(req.headers)
  const [, , , id, action] = parts
  if (req.method === 'GET' && !id) {
    const [rules, events] = await Promise.all([
      pool.query<RetentionRule>(`select ${columns} from retention_rule where "organizationId" = $1 order by lower(name), id`, [orgId]),
      pool.query(`select e.name, e.action, e.moved, u.name as actor, e."createdAt" from retention_rule_event e
        left join "user" u on u.id = e."actorId" where e."organizationId" = $1 order by e.id desc limit 25`, [orgId]),
    ])
    return Response.json({ rules: rules.rows, events: events.rows }, { headers })
  }
  if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Only workspace owners and admins can manage retention rules.')
  if (id === 'preview' && !action && req.method === 'POST') {
    const draft = parseRetention(await req.json().catch(() => null))
    return Response.json(await previewRetention(orgId, draft), { headers })
  }
  if (id !== undefined && !RULE_ID.test(id)) throw new HttpError(404, 'Unknown retention rule.')
  const find = async (db: Database, ruleId = id) => {
    const { rows: [rule] } = await db.query<RetentionRule>(`select ${columns} from retention_rule where id = $1 and "organizationId" = $2`, [ruleId, orgId])
    if (!rule) throw new HttpError(404, 'Unknown retention rule.')
    return rule
  }
  if (id && action === 'run' && parts.length === 5 && req.method === 'POST') {
    const moved = await apply(orgId, await find(pool), user.id)
    return Response.json({ moved }, { headers })
  }
  if (action !== undefined || !(req.method === 'POST' && !id || (req.method === 'PUT' || req.method === 'DELETE') && id)) throw new HttpError(405, 'Unsupported retention rule operation.')
  const draft = req.method === 'DELETE' ? null : parseRetention(await req.json().catch(() => null))
  const target = id ?? 'rtn_' + randomUUID().replaceAll('-', '')
  const db = await pool.connect()
  try {
    await db.query('begin')
    await db.query('select id from organization where id = $1 for update', [orgId])
    const old = id ? await find(db) : null
    let action = 'deleted'
    if (draft) {
      if (draft.folderId && !(await db.query('select 1 from folder where id = $1 and "organizationId" = $2', [draft.folderId, orgId])).rowCount) throw new HttpError(404, 'That folder does not exist in this workspace.')
      const values = [target, orgId, draft.name, draft.enabled, draft.folderId, draft.includeSubfolders, draft.kinds, draft.tag, draft.basis, draft.days]
      if (old) {
        await db.query(`update retention_rule set name = $3, enabled = $4, "folderId" = $5, "includeSubfolders" = $6, kinds = $7, tag = $8, basis = $9, days = $10,
          "updatedAt" = now() where id = $1 and "organizationId" = $2`, values)
        const same = (Object.keys(draft) as (keyof RetentionDraft)[]).every(k => k === 'enabled' || JSON.stringify(old[k]) === JSON.stringify(draft[k]))
        action = same && old.enabled !== draft.enabled ? (draft.enabled ? 'resumed' : 'paused') : 'updated'
      } else {
        const { rows: [{ count }] } = await db.query<{ count: number }>('select count(*)::int as count from retention_rule where "organizationId" = $1', [orgId])
        if (count >= MAX_RULES) throw new HttpError(409, `A workspace can have up to ${MAX_RULES} retention rules.`)
        await db.query(`insert into retention_rule (id, "organizationId", name, enabled, "folderId", "includeSubfolders", kinds, tag, basis, days, "createdBy")
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [...values, user.id])
        action = 'created'
      }
    } else {
      await db.query('delete from retention_rule where id = $1 and "organizationId" = $2', [target, orgId])
    }
    await db.query(`insert into retention_rule_event ("organizationId", "ruleId", name, action, "actorId") values ($1, $2, $3, $4, $5)`,
      [orgId, target, draft?.name ?? old!.name, action, user.id])
    const saved = draft ? await find(db, target) : null
    await db.query('commit')
    return saved ? Response.json({ rule: saved }, { status: id ? 200 : 201, headers }) : new Response(null, { status: 204, headers })
  } catch (error) {
    await db.query('rollback')
    if ((error as { code?: string }).code === '23505') throw new HttpError(409, 'This workspace already has a rule with that name.')
    throw error
  } finally {
    db.release()
  }
}
