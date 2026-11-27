import type { PoolClient } from 'pg'
import { pool } from '../auth.mts'
import { HttpError } from './assets.mts'
import { requireScope, type Actor } from './keys.mts'

type State = 'in_review' | 'changes_requested' | 'approved'
type Event = { id: string; state: State; actor: string; comment: string; createdAt: string }
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export async function latestReview(db: PoolClient, org: string, revision: string) {
  const { rows } = await db.query<Event>(
    'select id,state,actor,comment,"createdAt" from asset_review_event where "organizationId"=$1 and "revisionId"=$2 order by id desc limit 1',
    [org, revision])
  return rows[0]
}

export async function reviewAsset(a: Actor, req: Request, id: string) {
  const write = req.method === 'POST'
  if (!write && req.method !== 'GET') throw new HttpError(405, 'Method not allowed.')
  requireScope(a, write ? 'upload' : 'read')
  const input = write ? await req.json().catch(() => null) : null
  if (write && (!input || !uuid.test(input.revisionId ?? '') ||
      !['submit','request_changes','approve'].includes(input.action) ||
      !(input.expectedEvent === null || typeof input.expectedEvent === 'string') ||
      typeof input.comment !== 'string' || input.comment.length > 2000 ||
      (input.action === 'request_changes' && !input.comment.trim())))
    throw new HttpError(400, 'Supply the revision, last review event, action, and a comment of up to 2000 characters. Requested changes need a comment.')
  if (write && input.action === 'submit' && ['viewer','reviewer'].includes(a.role)) throw new HttpError(403,'Contributor access required.')
  if (write && input.action !== 'submit' && a.via !== 'session')
    throw new HttpError(403, 'A workspace owner or administrator must review this version.')
  const db = await pool.connect()
  try {
    await db.query('begin')
    const { rows: [asset] } = await db.query(`select "assignedReviewer","revisionId",status,"takenDown",moderation from asset where id=$1 and "organizationId"=$2 and "deletedAt" is null ${write ? 'for update' : 'for share'}`, [id,a.orgId])
    if (!asset) throw new HttpError(404, 'Asset unavailable in this workspace.')
    if (write && input.action !== 'submit' && (asset.assignedReviewer ? a.userId !== asset.assignedReviewer : !['admin','owner','reviewer'].includes(a.role)))
      throw new HttpError(403,'This decision requires the assigned reviewer or an authorized workspace reviewer.')
    const revision = asset.revisionId
    const previous = await latestReview(db,a.orgId,revision)
    if (write) {
      if (asset.status !== 'ready' || asset.takenDown || asset.moderation === 'rejected') throw new HttpError(409, 'This file is unavailable for review.')
      if (revision !== input.revisionId || (previous?.id ?? null) !== input.expectedEvent)
        throw new HttpError(409, 'The file or review has changed. Refresh before continuing.')
      const actor = a.via === 'key' ? 'key:' + a.keyId : 'user:' + a.userId
      const state: State = input.action === 'submit' ? 'in_review' : input.action === 'approve' ? 'approved' : 'changes_requested'
      if (input.action === 'submit' ? previous && previous.state !== 'changes_requested' : previous?.state !== 'in_review')
        throw new HttpError(409, 'This action is unavailable in the current review state.')
      if (input.action !== 'submit' && previous?.actor === actor) throw new HttpError(403, 'A different reviewer must decide this submission.')
      await db.query('insert into asset_review_event ("organizationId","assetId","revisionId",state,actor,comment) values ($1,$2,$3,$4,$5,$6)', [a.orgId,id,revision,state,actor,input.comment.trim()])
    }
    const { rows: history } = await db.query('select id,state,actor,comment,"createdAt" from asset_review_event where "organizationId"=$1 and "revisionId"=$2 order by id desc limit 50', [a.orgId,revision])
    await db.query('commit')
    return Response.json({ assetId: id, assignedReviewer:asset.assignedReviewer, revisionId: revision, latest: history[0] ?? null, history }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    await db.query('rollback')
    throw error
  } finally {
    db.release()
  }
}
