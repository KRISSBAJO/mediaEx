import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '../auth.mts'
import { HttpError, MAX_UPLOAD_BYTES, requireMember } from './assets.mts'
import type { MediaType, UploadPolicy, UploadPreset } from './types.mts'

const PRESET_ID = /^pre_[0-9a-f]{32}$/
const KINDS: MediaType[] = ['image', 'video', 'audio']

function integer(value: unknown, maximum: number, label: string) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new HttpError(400, `${label} must be a whole number between 1 and ${maximum}.`)
  }
  return value
}

export function parsePreset(input: unknown): Omit<UploadPreset, 'id'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Expected an upload preset.')
  const draft = input as Record<string, unknown>
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!name || name.length > 80) throw new HttpError(400, 'Preset names must be 1–80 characters.')
  const folderId = draft.folderId ?? null
  if (folderId !== null && (typeof folderId !== 'string' || !/^fld_[a-z0-9]{4,24}$/.test(folderId))) throw new HttpError(400, 'Invalid destination folder.')
  if (typeof draft.isDefault !== 'boolean') throw new HttpError(400, 'Specify whether this is the default preset.')
  if (!draft.policy || typeof draft.policy !== 'object') throw new HttpError(400, 'Specify the upload policy.')
  const p = draft.policy as Record<string, unknown>
  if (!Array.isArray(p.kinds) || !p.kinds.length || !p.kinds.every(k => KINDS.includes(k))) throw new HttpError(400, 'Select one or more supported media types.')
  if (typeof p.review !== 'boolean' || !['signed', 'public'].includes(String(p.playback))) throw new HttpError(400, 'Invalid review or playback setting.')
  const maxShortSide = integer(p.maxShortSide, 4320, 'Output short side')
  if (maxShortSide !== null && ![360, 480, 720, 1080, 1440, 2160, 4320].includes(maxShortSide)) throw new HttpError(400, 'Select a supported output resolution.')
  return { name, folderId, isDefault: draft.isDefault, policy: {
    kinds: [...new Set<MediaType>(p.kinds)], maxBytes: integer(p.maxBytes, MAX_UPLOAD_BYTES, 'Maximum file size'),
    review: p.review, playback: p.playback as UploadPolicy['playback'], maxShortSide,
    maxSourceEdge: integer(p.maxSourceEdge, 65535, 'Maximum source edge'), maxDuration: integer(p.maxDuration, 604800, 'Maximum duration'),
  } }
}

export function checkUploadPolicy(p: UploadPolicy | null, kind: MediaType, bytes: number) {
  if (!p) return
  if (!p.kinds.includes(kind)) throw new HttpError(415, 'This upload preset does not accept this media type.')
  if (p.maxBytes !== null && bytes > p.maxBytes) throw new HttpError(413, 'This file exceeds the upload preset size limit.')
}

export function checkProbedPolicy(p: UploadPolicy | null, info: {type: MediaType; width: number | null; height: number | null; duration: number}, bytes: number) {
  checkUploadPolicy(p, info.type, bytes)
  if (p?.maxSourceEdge && info.type !== 'audio' && (!info.width || !info.height)) throw new HttpError(422, 'The media dimensions could not be verified.')
  if (p?.maxSourceEdge && Math.max(info.width ?? 0, info.height ?? 0) > p.maxSourceEdge) throw new HttpError(422, 'The media dimensions exceed the upload preset limit.')
  if (p?.maxDuration && info.duration > p.maxDuration) throw new HttpError(422, 'The media duration exceeds the upload preset limit.')
}

export async function inWorkspaceTransaction<T>(orgId: string, run: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select id from organization where id = $1 for update', [orgId])
    const result = await run(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally { client.release() }
}

const columns = 'id, name, "folderId", "isDefault", policy'

export async function choosePreset(client: PoolClient, orgId: string, selected: unknown): Promise<UploadPreset | null> {
  if (selected != null && (typeof selected !== 'string' || !PRESET_ID.test(selected))) throw new HttpError(400, 'Invalid upload preset.')
  const { rows } = await client.query<UploadPreset>(`select ${columns} from upload_preset where "organizationId" = $1 and ${selected == null ? '"isDefault"' : 'id = $2'}`, selected == null ? [orgId] : [orgId, selected])
  if (selected != null && !rows[0]) throw new HttpError(404, 'Upload preset does not exist in this workspace.')
  return rows[0] ?? null
}

export async function listPresets(orgId: string) {
  const { rows } = await pool.query<UploadPreset>(`select ${columns} from upload_preset where "organizationId" = $1 order by lower(name), id`, [orgId])
  return { presets: rows, maxUploadBytes: MAX_UPLOAD_BYTES }
}

export async function handlePresets(req: Request, id?: string) {
  const { orgId, role, user } = await requireMember(req.headers)
  const headers = { 'Cache-Control': 'private, no-store' }
  if (req.method === 'GET' && !id) return Response.json(await listPresets(orgId), { headers })
  if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Only workspace owners and admins can manage upload presets.')
  if (req.method === 'GET' && id === 'activity') {
    const events = await pool.query('select e.name, e.action, e."createdAt", u.name as actor from upload_preset_event e left join "user" u on u.id=e."actorId" where e."organizationId"=$1 order by e.id desc limit 25', [orgId])
    return Response.json({ events: events.rows }, { headers })
  }
  if (id && !PRESET_ID.test(id)) throw new HttpError(404, 'Unknown preset.')
  if (!(req.method === 'POST' && !id || req.method === 'PUT' && id || req.method === 'DELETE' && id)) throw new HttpError(405, 'Unsupported preset operation.')
  const draft = req.method === 'DELETE' ? null : parsePreset(await req.json().catch(() => null))
  const target = id ?? 'pre_' + randomUUID().replaceAll('-', '')
  try {
    const result = await inWorkspaceTransaction(orgId, async client => {
      const old = id ? await choosePreset(client, orgId, id) : null
      if (draft) {
        if (draft.folderId && !(await client.query('select 1 from folder where id = $1 and "organizationId" = $2', [draft.folderId, orgId])).rowCount) throw new HttpError(404, 'Destination folder does not exist in this workspace.')
        if (draft.isDefault) await client.query('update upload_preset set "isDefault" = false where "organizationId" = $1 and "isDefault" and id <> $2', [orgId, target])
        const values = [target, orgId, draft.name, draft.folderId, draft.isDefault, JSON.stringify(draft.policy)]
        if (old) await client.query('update upload_preset set name=$3,"folderId"=$4,"isDefault"=$5,policy=$6 where id=$1 and "organizationId"=$2', values)
        else await client.query('insert into upload_preset (id,"organizationId",name,"folderId","isDefault",policy) values($1,$2,$3,$4,$5,$6)', values)
      } else {
        await client.query('delete from upload_preset where id=$1 and "organizationId"=$2', [target,orgId])
      }
      await client.query('insert into upload_preset_event ("organizationId","actorId",action,"presetId",name) values ($1,$2,$3,$4,$5)', [orgId,user.id,draft ? old ? 'updated' : 'created' : 'deleted',target,draft?.name ?? old!.name])
      return draft && { id: target, ...draft }
    })
    return result ? Response.json({ preset: result }, { status: id ? 200 : 201, headers }) : new Response(null, { status: 204, headers })
  } catch (error) {
    if ((error as {code?: string}).code === '23505') throw new HttpError(409, 'This workspace already has a preset with that name.')
    throw error
  }
}
