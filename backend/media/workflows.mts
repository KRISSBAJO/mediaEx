import { flowBuilder } from './flow-builder.mts'
import { pool } from '../auth.mts'
import { HttpError } from './assets.mts'
import { captionsAvailable } from './captions.mts'
import { requireScope, type Actor } from './keys.mts'
import { reviewAsset } from './moderation.mts'
import { inWorkspaceTransaction } from './presets.mts'
import { retry } from './routes.mts'

const template = 'omoshow-upload-review'
const read = (data: unknown) => Response.json(data, {headers:{'Cache-Control':'no-store'}})
const runQuery = `select a.id, a.title, a.status, w.phase, w.captions, coalesce(w.error,a.error) as error,
  w.updated from review_workflow_run w join asset a on a.id=w.asset
  where a."organizationId"=$1 and a."deletedAt" is null`

export async function workflows(req: Request, actor: Actor, path: string[]) {
  const {orgId} = actor
  const get = req.method === 'GET'
  if (actor.via === 'key') requireScope(actor, get ? 'read' : 'full')
  else if (!get && !['owner','admin'].includes(actor.role)) throw new HttpError(403,'An owner or admin must manage workflows.')
  if (path[0]==='builder') return flowBuilder(req,actor,path.slice(1))
  if (get && !path.length) {
    const settings = await pool.query('select enabled,captions from review_workflow where org=$1',[orgId])
    return read({template, ...(settings.rows[0] ?? {enabled:false,captions:false}), captionsAvailable:captionsAvailable()})
  }
  if (get && path[0]==='runs' && path.length<=2) {
    const runs = await pool.query(runQuery + (path[1] ? ' and a.id=$2' : ' order by a."createdAt" desc,a.id desc limit 100'),path[1]?[orgId,path[1]]:[orgId])
    if (path[1] && !runs.rowCount) throw new HttpError(404,'Workflow run not found.')
    return read({runs:runs.rows})
  }
  if (req.method==='PUT' && path.length===1 && path[0]===template) {
    const body = await req.json().catch(()=>null)
    if (typeof body?.enabled!=='boolean' || typeof body?.captions!=='boolean') throw new HttpError(400,'Supply enabled and captions as booleans.')
    if (body.enabled && body.captions && !captionsAvailable()) throw new HttpError(409,'Configure OPENAI_API_KEY on the backend before enabling captions.')
    await inWorkspaceTransaction(orgId, client=>client.query(`insert into review_workflow(org,enabled,captions) values($1,$2,$3)
      on conflict(org) do update set enabled=excluded.enabled,captions=excluded.captions`,[orgId,body.enabled,body.captions]))
    return read({template,enabled:body.enabled,captions:body.captions})
  }
  if (req.method==='POST' && path.length===3 && path[0]==='runs' && path[2]==='retry') {
    const id=path[1]
    const processing = await inWorkspaceTransaction(orgId, async client=>{
      const {rows:[run]} = await client.query(runQuery+' and a.id=$2 for update of w',[orgId,id])
      if (!run) throw new HttpError(404,'Workflow run not found.')
      if (run.status==='failed' && run.phase==='prepare') return true
      if (!run.error || run.status!=='ready') throw new HttpError(409,'This step has no failure to retry.')
      if (run.phase==='captions') {
        if (!captionsAvailable()) throw new HttpError(409,'Configure OPENAI_API_KEY on the backend before retrying captions.')
        await client.query(`update caption set status='queued', attempts=0,error=null,"nextAttemptAt"=now(),"updatedAt"=now()
          where "assetId"=$1 and source='auto' and status='failed'`,[id])
      }
      await client.query('update review_workflow_run set error=null, updated=now() where asset=$1',[id])
      return false
    })
    return processing ? retry(actor,id,true) : read({queued:true})
  }
  throw new HttpError(404,'Workflow endpoint not found.')
}

/** Each poll advances one eligible asset. A locked run prevents competing workers from submitting the same step. */
export async function advanceWorkflows() {
  const client=await pool.connect()
  try {
    await client.query('begin')
    const {rows:[run]}=await client.query(`select w.* from review_workflow_run w join asset a on a.id=w.asset
      where a.status='ready' and a."deletedAt" is null and a."takenDown" is null and w.phase<>'complete' and w.error is null
      and not exists(select 1 from workspace_admin s where s."organizationId"=a."organizationId" and s."suspendedAt" is not null)
      order by w.updated,w.asset limit 1 for update of w skip locked`)
    if (run) {
      let phase=run.phase
      let error:string|null=null
      if (phase==='prepare') phase=run.captions?'captions':'review'
      if (phase==='captions') {
        const {rows:[track]}=await client.query(`select status,error from caption where "assetId"=$1 and source='auto'
          order by (status='ready') desc,"updatedAt" desc limit 1`,[run.asset])
        if (track?.status==='ready') phase='review'
        else if (!captionsAvailable()) error='Configure OPENAI_API_KEY on the backend.'
        else if (track?.status==='failed') error=track.error || 'Caption generation failed.'
        else if (!track) await client.query(`insert into caption("assetId",lang,label,source,status) values($1,'auto','Transcribing','auto','queued')
          on conflict ("assetId",lang) do nothing`,[run.asset])
      }
      if (phase==='review') {
        try { await reviewAsset(run.asset); phase='complete' }
        catch { error='Review checks failed. Retry to run the checks again.' }
      }
      await client.query('update review_workflow_run set phase=$2,error=$3,updated=now() where asset=$1',[run.asset,phase,error])
    }
    await client.query('commit')
  } catch(e) { await client.query('rollback'); throw e }
  finally {client.release()}
}
