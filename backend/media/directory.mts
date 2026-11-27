import { createHash,randomUUID,timingSafeEqual } from 'node:crypto'
import { pool } from '../auth.mts'
import { HttpError } from './assets.mts'

const schema='urn:ietf:params:scim:schemas:core:2.0:User'
const out=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Content-Type':'application/scim+json','Cache-Control':'no-store'}})
type Entry={id:string;email:string;name:string;externalId:string;active:boolean}
const resource=(row:Entry)=>({schemas:[schema],id:row.id,userName:row.email,displayName:row.name,externalId:row.externalId,active:row.active})
const select='select d.id,d."externalId",d.active,u.email,u.name from directory_member d join "user" u on u.id=d."userId" where d.org=$1'

export async function directory(req:Request,path:string[]) {
  const digest=createHash('sha256').update((req.headers.get('authorization')??'').replace(/^Bearer /i,'')).digest()
  const configured=JSON.parse(process.env.MEDIAEX_DIRECTORY_KEYS??'{}') as Record<string,string>
  const org=Object.keys(configured).find(k=>/^[0-9a-f]{64}$/.test(configured[k]) && timingSafeEqual(digest,Buffer.from(configured[k],'hex')))
  if (!org || !/^Bearer \S+$/i.test(req.headers.get('authorization')??''))throw new HttpError(401,'Invalid provisioning credential.')
  if(path[0]!=='Users'||path.length>2)throw new HttpError(404,'Unknown directory resource.')
  const id=path[1]
  if(id&&!/^[0-9a-f-]{36}$/i.test(id))throw new HttpError(404,'Directory user unavailable.')
  if(req.method==='GET') {
    if(id){const r=await pool.query(select+' and d.id=$2',[org,id]);if(!r.rowCount)throw new HttpError(404,'Directory user unavailable.');return out(resource(r.rows[0]))}
    const p=new URL(req.url).searchParams,filter=p.get('filter'),match=filter&&/^userName eq "([^"]+)"$/i.exec(filter)
    if(filter&&!match)throw new HttpError(400,'Use a userName equality filter.')
    const start=Math.max(1,Number(p.get('startIndex')??1)),count=Math.min(100,Math.max(0,Number(p.get('count')??100)))
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(count))throw new HttpError(400,'Invalid pagination.')
    const where=' and ($2::text is null or lower(u.email)=lower($2))'
    const args=[org,match?match[1]:null]
    const rows=await pool.query(select+where+' order by d.id limit $3 offset $4',[...args,count,start-1])
    const total=await pool.query('select count(*)::int as n from ('+select+where+') s',args)
    return out({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:total.rows[0].n,startIndex:start,itemsPerPage:rows.rows.length,Resources:rows.rows.map(resource)})
  }
  const body=req.method==='DELETE'?{}:await req.json().catch(()=>null)
  if(!body)throw new HttpError(400,'Invalid directory operation.')
  const db=await pool.connect()
  try {
    await db.query('begin')
    await db.query("select set_config('mediaex.actor',$1,true)",['directory:'+org])
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['directory:'+org])
    let target=id
    if(req.method==='POST'&&!id){
      const email=typeof body.userName==='string'?body.userName.trim().toLowerCase():''
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof body.externalId!=='string'||!body.externalId.length||body.externalId.length>200)
        throw new HttpError(400,'Supply userName and externalId.')
      const existing=await db.query(select+' and (d."externalId"=$2 or lower(u.email)=$3)',[org,body.externalId,email])
      if(existing.rowCount)throw new HttpError(409,'Directory user already exists.')
      const created=await db.query(`insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt") values ($1,$2,$3,false,now(),now()) on conflict(email) do nothing returning id`,
        [randomUUID(),String(body.displayName??email).slice(0,200),email])
      const user=created.rows[0]??(await db.query('select id from "user" where email=$1 and "emailVerified"=true',[email])).rows[0]
      if(!user)throw new HttpError(409,'Account unavailable.')
      target=randomUUID()
      await db.query('insert into directory_member (id,org,"userId","externalId",active) values($1,$2,$3,$4,false)',[target,org,user.id,body.externalId])
    } else if(!id||!['PATCH','DELETE','PUT'].includes(req.method))throw new HttpError(405,'Method not allowed.')
    let active=body.active??true
    if(req.method==='DELETE')active=false
    if(req.method==='PATCH'){
      const ops=body.Operations
      if(!Array.isArray(ops)||ops.length!==1||!['replace','add'].includes(String(ops[0]?.op).toLowerCase())||String(ops[0].path).toLowerCase()!=='active')throw new HttpError(400,'Only active changes are supported.')
      active=ops[0].value
    }
    if(typeof active!=='boolean')throw new HttpError(400,'active must be boolean.')
    const d=(await db.query('select * from directory_member where org=$1 and id=$2 for update',[org,target])).rows[0]
    if(!d)throw new HttpError(404,'Directory user unavailable.')
    if(active&&!d.active){
      if((await db.query('select 1 from member where "organizationId"=$1 and "userId"=$2',[org,d.userId])).rowCount)throw new HttpError(409,'A membership already exists outside this directory.')
      await db.query('insert into member(id,"organizationId","userId",role,"createdAt") values($1,$2,$3,$4,now())',[target,org,d.userId,'viewer'])
    } else if(!active&&d.active){
      const old=(await db.query('select role from member where id=$1 and "organizationId"=$2 for update',[target,org])).rows[0]
      if(old?.role?.split(',').includes('owner'))throw new HttpError(409,'Transfer workspace ownership before deprovisioning.')
      await db.query('delete from member where id=$1 and "organizationId"=$2',[target,org])
    }
    await db.query('update directory_member set active=$3 where id=$1 and org=$2',[target,org,active])
    const row=(await db.query(select+' and d.id=$2',[org,target])).rows[0]
    if(req.method==='DELETE')await db.query('delete from directory_member where id=$1 and org=$2',[target,org])
    await db.query('commit')
    return req.method==='DELETE'?new Response(null,{status:204}):out(resource(row),req.method==='POST'?201:200)
  }catch(error){await db.query('rollback');throw error}finally{db.release()}
}
