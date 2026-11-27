import { randomUUID } from 'node:crypto'
import { pool } from '../auth.mts'
import { HttpError } from './assets.mts'
import { type Actor } from './keys.mts'
import { listFields, validateValue } from './fields.mts'

export async function metadataJobs(req:Request,a:Actor,id?:string) {
  if (id && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(400,'Invalid job.')
  const noStore = {headers:{'Cache-Control':'private, no-store'}}
  if (req.method==='GET') {
    const {rows}=await pool.query(`select j.id,j.state,j.field,j.value,j."createdAt", count(i.*)::int as total,
      count(*) filter(where i.status='done')::int as done,count(*) filter(where i.status='failed')::int as failed
      from metadata_job j join metadata_job_item i on i.job=j.id where j.org=$1 and ($2::uuid is null or j.id=$2)
      group by j.id order by j."createdAt" desc limit 25`,[a.orgId,id??null])
    if (id && !rows.length) throw new HttpError(404,'Job unavailable.')
    const items=id ? (await pool.query('select asset,status,error,before_value from metadata_job_item where job=$1 order by asset',[id])).rows : []
    return Response.json({jobs:rows,items},noStore)
  }
  if (['reviewer','viewer'].includes(a.role)) throw new HttpError(403,'Contributor access required.')
  if (id && (req.method==='PATCH' || req.method==='DELETE')) {
    const state=req.method==='DELETE'?'cancelled':'running'
    const result=await pool.query(`update metadata_job set state=$1 where org=$2 and id=$3 and (creator=$4 or $5) and
      (state='preview' or ($1='cancelled' and state='running'))`,[state,a.orgId,id,a.userId,['owner','admin'].includes(a.role)])
    if (!result.rowCount) throw new HttpError(409,'Job unavailable for this action.')
    return Response.json({state},noStore)
  }
  if (id || req.method!=='POST') throw new HttpError(405,'Method not allowed.')
  const b=await req.json().catch(()=>null)
  if (!b || !Array.isArray(b.ids) || !b.ids.length || b.ids.length>500 || !b.ids.every((x:unknown)=>typeof x==='string' && /^ast_[a-z0-9]{6,20}$/.test(x))) throw new HttpError(400,'Select up to 500 assets.')
  const field=(await listFields(a.orgId)).find(f=>f.id===b.field)
  if (!field) throw new HttpError(400,'Select a workspace field.')
  const value=validateValue(field,b.value)
  const job=randomUUID()
  const {rowCount}=await pool.query(`with newjob as (insert into metadata_job (id,org,creator,field,value) values ($1,$2,$3,$4,$5) returning id)
    insert into metadata_job_item(job,asset,before_value,status,error)
    select j.id,selected.id,a.metadata->$4::text,case when a.id is null then 'failed' else 'pending' end,case when a.id is null then 'Asset unavailable.' end
    from newjob j cross join (select distinct unnest($6::text[]) as id) selected left join asset a on a."organizationId"=$2 and a."deletedAt" is null and a.id=selected.id`,
    [job,a.orgId,a.userId,field.id,JSON.stringify(value??null),b.ids])
  if (!rowCount) {await pool.query('delete from metadata_job where id=$1',[job]);throw new HttpError(404,'No matching assets.')}
  return Response.json({job,matched:rowCount,requested:new Set(b.ids).size,state:'preview'},noStore)
}

export async function runMetadataJobs() {
  for (let count=0;count<25;count++) {
    const db=await pool.connect()
    try {
      await db.query('begin')
      const job=(await db.query("select * from metadata_job where state='running' order by \"createdAt\" limit 1 for update skip locked")).rows[0]
      if (!job) {await db.query('commit');return}
      const item=(await db.query("select asset,before_value from metadata_job_item where job=$1 and status='pending' order by asset limit 1",[job.id])).rows[0]
      if (!item) await db.query("update metadata_job set state='complete' where id=$1",[job.id])
      else {
        const member=await db.query("select 1 from member where \"organizationId\"=$1 and \"userId\"=$2 and role in ('owner','admin','member','contributor') for share",[job.org,job.creator])
        const field=(await db.query('select * from metadata_field where id=$1 and "organizationId"=$2 for share',[job.field,job.org])).rows[0]
        let error:string|null=null
        if (!member.rowCount || !field) error='Field or contributor access is unavailable.'
        else try {validateValue(field,job.value)} catch (e) {error=e instanceof Error?e.message:'Invalid value.'}
        if (!error) {
          const changed=await db.query(`update asset set metadata=case when $3::jsonb='null'::jsonb then metadata-$2::text else jsonb_set(metadata,array[$2],$3::jsonb) end,
            "updatedAt"=now() where id=$1 and "organizationId"=$4 and "deletedAt" is null and metadata->$2::text is not distinct from $5::jsonb`,[item.asset,job.field,JSON.stringify(job.value),job.org,item.before_value===null?null:JSON.stringify(item.before_value)])
          if (!changed.rowCount) error='Asset or metadata changed after preview.'
        }
        await db.query('update metadata_job_item set status=$1,error=$2 where job=$3 and asset=$4',[error?'failed':'done',error,job.id,item.asset])
      }
      await db.query('commit')
    } catch (error) {await db.query('rollback');throw error} finally {db.release()}
  }
}
