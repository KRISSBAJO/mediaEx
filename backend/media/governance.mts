import { pool } from '../auth.mts'
import { HttpError } from './assets.mts'
import { type Actor } from './keys.mts'

const noStore = {'Cache-Control':'private, no-store'}
export async function rights(req: Request, actor: Actor, id: string) {
  if (actor.via !== 'session' || !['admin','owner'].includes(actor.role)) throw new HttpError(403,'Workspace administration is required.')
  if (req.method === 'GET') {
    const { rows:[asset] } = await pool.query('select retired,"revisionId","rightsExpireAt","assignedReviewer","policyGeneration" from asset where id=$1 and "organizationId"=$2 and "deletedAt" is null',[id,actor.orgId])
    if (!asset) throw new HttpError(404,'Asset unavailable.')
    const reviewers = await pool.query('select u.id,u.name from member m join "user" u on u.id=m."userId" where m."organizationId"=$1 and m.role<>\'viewer\' order by u.name,u.id',[actor.orgId])
    return Response.json({...asset,reviewers:reviewers.rows},{headers:noStore})
  }
  if (req.method !== 'PUT') throw new HttpError(405,'Method not allowed.')
  const b = await req.json().catch(()=>null)
  if (!b || typeof b.retired!=="boolean" || !Number.isSafeInteger(b.policyGeneration) || typeof b.revisionId!=='string' ||
      !(b.assignedReviewer===null || typeof b.assignedReviewer==='string') ||
      !(b.rightsExpireAt===null || typeof b.rightsExpireAt==='string' && Number.isFinite(Date.parse(b.rightsExpireAt))))
    throw new HttpError(400,'Supply a valid revision, policy generation, reviewer and expiry.')
  const changed = await pool.query(`with updated as (update asset set retired=$9,"assignedReviewer"=$3,"rightsExpireAt"=$4,"policyGeneration"="policyGeneration"+1
    where id=$1 and "organizationId"=$2 and "deletedAt" is null and "revisionId"=$5 and "policyGeneration"=$6
    and ($3::text is null or exists(select 1 from member where "userId"=$3 and "organizationId"=$2 and role<>'viewer'))
    returning id,"revisionId") insert into asset_recovery_event ("organizationId","assetId","revisionId",action,actor)
    select $2,id,"revisionId",$7,$8 from updated`,[id,actor.orgId,b.assignedReviewer,b.rightsExpireAt,b.revisionId,b.policyGeneration,
    (b.retired?'retired; ':'active; ')+'rights updated; expires '+(b.rightsExpireAt ?? 'never')+'; reviewer '+(b.assignedReviewer ?? 'unassigned'),'user:'+actor.userId,b.retired])
  if (!changed.rowCount) throw new HttpError(409,'The policy changed or the reviewer is unavailable.')
  return Response.json({updated:true},{headers:noStore})
}

export async function auditExport(req: Request, actor: Actor) {
  if (actor.via === 'key' ? actor.scope!=='full' : !['admin','owner'].includes(actor.role)) throw new HttpError(403,'Workspace administration is required.')
  if (req.method!=='GET') throw new HttpError(405,'Method not allowed.')
  const params=new URL(req.url).searchParams
  if (params.get('format')==='ndjson') {
    const {rows:[high]}=await pool.query('select coalesce(max(id),0)::text as id from governance_audit where "organizationId"=$1',[actor.orgId])
    await pool.query('insert into governance_audit ("organizationId",action,actor,details) values ($1,$2,$3,$4)',[actor.orgId,'audit.export',actor.via==='key'?'key:'+actor.keyId:'user:'+actor.userId,{through:high.id}])
    let cursor='0'
    const encoder=new TextEncoder()
    const stream=new ReadableStream<Uint8Array>({async pull(controller){
      const {rows}=await pool.query('select id,action,actor,details,"createdAt" from governance_audit where "organizationId"=$1 and id>$2 and id<=$3 order by id limit 500',[actor.orgId,cursor,high.id])
      if(rows.length){controller.enqueue(encoder.encode(rows.map(row=>JSON.stringify(row)).join('\n')+'\n'));cursor=rows[rows.length-1].id}
      if(rows.length<500)controller.close()
    }})
    return new Response(stream,{headers:{...noStore,'Content-Type':'application/x-ndjson','Content-Disposition':'attachment; filename="mediaex-audit.ndjson"'}})
  }
  const after = new URL(req.url).searchParams.get('after') ?? '0'
  if (!/^\d{1,18}$/.test(after)) throw new HttpError(400,'Invalid audit cursor.')
  const {rows} = await pool.query('select id,action,actor,details,"createdAt" from governance_audit where "organizationId"=$1 and id>$2 order by id limit 501',[actor.orgId,after])
  const events=rows.slice(0,500)
  await pool.query('insert into governance_audit ("organizationId",action,actor,details) values ($1,$2,$3,$4)',[actor.orgId,'audit.export',actor.via==='key'?'key:'+actor.keyId:'user:'+actor.userId,{after,count:events.length}])
  return Response.json({events,next:rows.length>500?events[499].id:null},{headers:{...noStore,'Content-Disposition':'attachment; filename="mediaex-audit.json"'}})
}
