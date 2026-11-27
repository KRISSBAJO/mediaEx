import type { PoolClient } from 'pg'
import { pool } from '../auth.mts'
import { HttpError } from './assets.mts'
import { requireScope, type Actor } from './keys.mts'
import { latestReview } from './reviews.mts'

const resourceKey = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/
const response = (data: unknown) => Response.json(data, { headers: { 'Cache-Control':'private, no-store' } })

export async function listReferences(actor: Actor, id: string) {
  requireScope(actor, 'read')
  const { rows } = await pool.query('select application, resource, slot, "revisionId", generation from media_reference where "organizationId"=$1 and "assetId"=$2 order by application,resource,slot', [actor.orgId,id])
  return response({ references:rows })
}

export async function assertUnreferenced(db: PoolClient, org: string, ids: string[]) {
  const { rows: [used] } = await db.query('select application,resource,slot from media_reference where "organizationId"=$1 and "assetId"=any($2::text[]) limit 1', [org,ids])
  if (used) throw new HttpError(409, 'Reassign or detach the registered '+used.slot+' on '+used.application+' '+used.resource+' before changing this asset.')
}

// Each application resource publishes independently. A removed slot retains its generation to reject stale writes.
export async function reference(req: Request, actor: Actor) {
  if (!['GET','PUT','DELETE'].includes(req.method)) throw new HttpError(405,'Method not allowed.')
  const read = req.method === 'GET'
  if(actor.scope!=='publish') requireScope(actor,read ? 'read' : 'full')
  const params = new URL(req.url).searchParams
  const key = ['application','resource','slot'].map(name => params.get(name) ?? '')
  if (actor.scope==='publish' && actor.keyName!==key[0]) throw new HttpError(403,'This service key belongs to a different application.')
  if (read && resourceKey.test(key[0]) && !key[1] && !key[2]) {
    const cursorResource=params.get('afterResource')??'',cursorSlot=params.get('afterSlot')??''
    const {rows}=await pool.query(`select resource,slot,"assetId","revisionId",generation from media_reference
      where "organizationId"=$1 and application=$2 and (resource,slot)>($3,$4) order by resource,slot limit 201`,[actor.orgId,key[0],cursorResource,cursorSlot])
    const entries=rows.slice(0,200)
    return response({entries,next:rows.length===201?{afterResource:entries[199].resource,afterSlot:entries[199].slot}:null})
  }
  if (!key.every(value => resourceKey.test(value))) throw new HttpError(400,'Provide an application, resource, and slot.')

  const args = [actor.orgId,...key]
  const where = '"organizationId"=$1 and application=$2 and resource=$3 and slot=$4'
  const body = read ? null : await req.json().catch(() => null)
  if (!read && (!body || !Number.isSafeInteger(body.expectedGeneration) || body.expectedGeneration < 0 ||
      typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500))
    throw new HttpError(400,'Supply the current generation and a reason of up to 500 characters.')
  const db = await pool.connect()
  try {
    await db.query(read ? 'begin isolation level repeatable read read only' : 'begin')
    if (!read) await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(args)])
    const current = (await db.query('select "assetId","revisionId",generation from media_reference where '+where,args)).rows[0] ?? {assetId:null,revisionId:null,generation:0}
    if (read) {
      const { rows: history } = await db.query('select generation,"assetId","revisionId",actor,reason,"createdAt" from media_reference_event where '+where+' order by generation desc limit 100',args)
      await db.query('commit')
      return response({...current,history})
    }
    const desiredAsset=req.method==='DELETE'?null:body.assetId
    const desiredRevision=req.method==='DELETE'?null:body.revisionId
    if (current.generation === body.expectedGeneration+1 && current.assetId===desiredAsset && current.revisionId===desiredRevision) {
      await db.query('commit')
      return response(current)
    }
    if (current.generation !== body.expectedGeneration) throw new HttpError(409,'The application reference changed. Refresh before continuing.')
    let assetId = null, revisionId = null
    if (req.method === 'PUT') {
      if (typeof body.assetId !== 'string' || typeof body.revisionId !== 'string') throw new HttpError(400,'Supply the approved asset and revision.')
      const row = (await db.query('select retired,"revisionId",status,moderation,"takenDown","rightsExpireAt" from asset where id=$1 and "organizationId"=$2 and "deletedAt" is null for update',[body.assetId,actor.orgId])).rows[0]
      if (!row || row.retired || row.revisionId !== body.revisionId || row.status !== 'ready' || row.moderation !== 'approved' || row.takenDown || (row.rightsExpireAt && new Date(row.rightsExpireAt).getTime()<=Date.now()) ||
          (await latestReview(db,actor.orgId,row.revisionId))?.state !== 'approved') throw new HttpError(409,'Select an available approved revision.')
      const missing = await db.query(`select f.label from metadata_field f join asset a on a."organizationId"=f."organizationId" where a.id=$1
        and f.required and (nullif(btrim(a.metadata->>f.id),'') is null or a.metadata->f.id='[]'::jsonb) limit 1`,[body.assetId])
      if (missing.rowCount) throw new HttpError(409,'Complete required metadata: '+missing.rows[0].label)
      assetId = body.assetId
      revisionId = row.revisionId
    }
    if (current.assetId === assetId && current.revisionId === revisionId) {
      await db.query('commit')
      return response(current)
    }
    const generation = current.generation + 1
    const values = [...args, assetId, revisionId, generation]
    await db.query(`insert into media_reference ("organizationId",application,resource,slot,"assetId","revisionId",generation)
      values ($1,$2,$3,$4,$5,$6,$7) on conflict ("organizationId",application,resource,slot)
      do update set "assetId"=excluded."assetId","revisionId"=excluded."revisionId",generation=excluded.generation`, values)
    await db.query(`insert into media_reference_event ("organizationId",application,resource,slot,"assetId","revisionId",generation,actor,reason)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [...values,actor.via==='key'?'key:'+actor.keyId:'user:'+actor.userId,body.reason.trim()])
    await db.query('commit')
    return response({ assetId,revisionId,generation })
  } catch (error) {
    await db.query('rollback')
    throw error
  } finally { db.release() }
}
