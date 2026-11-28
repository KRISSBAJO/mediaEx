import { draftFlow,flowProviders } from './flow-agent.mts'
import { randomUUID } from 'node:crypto'
import { pool } from '../auth.mts'
import { HttpError } from './assets.mts'
import { inWorkspaceTransaction } from './presets.mts'
import type { Actor } from './keys.mts'

const kinds = ['inspect','match-type','match-tag','add-tag','log','notify'] as const
type Kind = typeof kinds[number]
type Block = {kind:Kind;value:string}
type Asset = {id:string;title:string;type:string;tags:string[];size:string}
type Flow = {id:string;name:string;enabled:boolean;version:number;blocks:Block[]}
const json = (value:unknown) => Response.json(value,{headers:{'Cache-Control':'no-store'}})

function definition(input:Record<string,unknown>) {
  const name=typeof input.name==='string'?input.name.trim():''
  if(!name || name.length>100 || typeof input.enabled!=='boolean') throw new HttpError(400,'Supply a name and activation state.')
  if(!Array.isArray(input.blocks) || !input.blocks.length || input.blocks.length>20) throw new HttpError(400,'Choose between one and twenty blocks.')
  const blocks:Block[]=input.blocks.map(block=>{
    if(!block || !kinds.includes(block.kind)) throw new HttpError(400,'Unknown workflow block.')
    const value=typeof block.value==='string'?block.value.trim():''
    if(block.kind!=='inspect' && (!value || value.length>200)) throw new HttpError(400,'Each configured block needs a value of up to 200 characters.')
    if(block.kind==='match-type' && !['video','image','audio'].includes(value)) throw new HttpError(400,'Choose video, image, or audio.')
    if(['match-tag','add-tag'].includes(block.kind) && value.length>40) throw new HttpError(400,'Tags are limited to 40 characters.')
    return {kind:block.kind,value:['match-tag','add-tag'].includes(block.kind)?value.toLowerCase():value}
  })
  const trigger=input.trigger??'manual'
  if(trigger!=='manual' && trigger!=='upload')throw new HttpError(400,'Unknown trigger.')
  return {name,enabled:input.enabled,blocks,trigger}
}

export function evaluateFlow(blocks:Block[],asset:Asset) {
  let matched=true
  const tags=new Set(asset.tags)
  const notifications:string[]=[]
  const steps=blocks.map(({kind,value})=>{
    if(!matched) return {kind,status:'skipped',detail:'Condition did not match'}
    let detail=value
    if(kind==='match-type') matched=asset.type===value
    if(kind==='match-tag') matched=[...tags].some(tag=>tag.toLowerCase()===value)
    if(kind==='inspect') detail=asset.title+' · '+asset.type+' · '+asset.size+' bytes'
    if(kind==='add-tag') tags.add(value)
    if(kind==='notify') notifications.push(value)
    return {kind,status:matched?'complete':'unmatched',detail}
  })
  return {steps,tags:[...tags],notifications}
}

export async function flowBuilder(req:Request,actor:Actor,path:string[]) {
  const {orgId}=actor
  if(req.method==='GET' && path.length===1 && path[0]==='parameters'){
    const {rows}=await pool.query('select name,value from media_flow_parameter where org=$1 order by name',[orgId])
    return json({parameters:rows})
  }
  if(req.method==='GET' && path.length===1 && path[0]==='usage'){
    const days=Number(new URL(req.url).searchParams.get('days')??30)
    if(![7,30,90].includes(days))throw new HttpError(400,'Choose 7, 30 or 90 days.')
    const {rows:[usage]}=await pool.query(`select count(*)::int as executions,count(distinct asset)::int as assets,
      coalesce(sum(jsonb_array_length(result->'steps')),0)::int as steps,
      coalesce(sum(jsonb_array_length(result->'notifications')),0)::int as notifications
      from media_flow_execution where org=$1 and created>=now()-$2::int*interval '1 day'`,[orgId,days])
    return json({days,usage})
  }
  if(req.method==='GET' && path.length===0){
    const {rows}=await pool.query('select id,name,enabled,version,blocks,trigger_kind as trigger from media_flow where org=$1 order by updated desc,id',[orgId])
    return json({flows:rows,providers:flowProviders()})
  }
  if(req.method==='GET' && path.length===1 && path[0]==='activity'){
    const {rows}=await pool.query(`select id,flow,version,name,asset,title,result,created from media_flow_execution where org=$1 order by created desc,id desc limit 100`,[orgId])
    return json({runs:rows})
  }
  const body=await req.json().catch(()=>null)
  if(!body || typeof body!=='object') throw new HttpError(400,'Supply a JSON object.')
  if(req.method==='PUT' && path.length===2 && path[0]==='parameters'){
    const key=path[1]
    if(!/^[a-z][a-z0-9_]{0,39}$/.test(key) || typeof body.value!=='string' || body.value.length>80 || !body.value.trim())
      throw new HttpError(400,'Use a lowercase parameter name and a value of up to 80 characters.')
    return inWorkspaceTransaction(orgId,async db=>{
      const snapshot=await db.query('select value from media_flow_parameter where org=$1 and name=$2',[orgId,key])
      if((snapshot.rows[0]?.value??null)!==body.previous)throw new HttpError(409,'Parameter changed. Reload before saving.')
      await db.query('insert into media_flow_parameter(org,name,value) values($1,$2,$3) on conflict(org,name) do update set value=excluded.value',[orgId,key,body.value.trim()])
      return json({name:key,value:body.value.trim()})
    })
  }
  if(req.method==='POST' && path.length===1 && path[0]==='agent'){
    const output=await draftFlow(orgId,body.provider,body.prompt)
    return json({draft:definition({...output,enabled:false,trigger:'manual'})})
  }
  if((req.method==='POST' && !path.length)||(req.method==='PUT' && path.length===1)){
    const spec=definition(body)
    return inWorkspaceTransaction(orgId,async db=>{
      const {rows}=await db.query<{name:string;value:string}>('select name,value from media_flow_parameter where org=$1',[orgId])
      const parameters=new Map(rows.map(p=>[p.name,p.value]))
      const {name,enabled,blocks,trigger}=definition({...spec,blocks:spec.blocks.map(b=>({...b,value:b.value.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g,(_,key:string)=>{
        const value=parameters.get(key)
        if(value===undefined)throw new HttpError(400,'Unknown parameter: '+key)
        return value
      })}))})
      const result=path.length?await db.query(`update media_flow set name=$3,enabled=$4,blocks=$5,trigger_kind=$7,version=version+1,updated=now()
        where org=$1 and id=$2 and version=$6 returning id,name,enabled,version,blocks,trigger_kind as trigger`,[orgId,path[0],name,enabled,JSON.stringify(blocks),body.version,trigger]):
        await db.query('insert into media_flow(id,org,name,enabled,blocks,trigger_kind) values($1,$2,$3,$4,$5,$6) returning id,name,enabled,version,blocks,trigger_kind as trigger',[randomUUID(),orgId,name,enabled,JSON.stringify(blocks),trigger])
      if(!result.rows.length) throw new HttpError(409,'The workflow changed. Reopen it before saving.')
      return json({flow:result.rows[0]})
    })
  }
  if(req.method==='POST' && path.length===2 && ['test','run'].includes(path[1])){
    const test=path[1]==='test'
    return inWorkspaceTransaction(orgId,async db=>{
      const {rows:[flow]}=await db.query<Flow>('select * from media_flow where org=$1 and id=$2',[orgId,path[0]])
      if(!flow) throw new HttpError(404,'Workflow not found.')
      if(flow.version!==body.version) throw new HttpError(409,'Reopen the latest workflow version.')
      if(!test && !flow.enabled) throw new HttpError(409,'Enable this workflow before running it.')
      const {rows:[asset]}=await db.query<Asset>(`select id,title,type,tags,size from asset where "organizationId"=$1 and id=$2 and "deletedAt" is null and "takenDown" is null and status='ready' for update`,[orgId,body.assetId])
      if(!asset) throw new HttpError(404,'Choose a ready asset in this workspace.')
      const result=evaluateFlow(flow.blocks,asset)
      if(test) return json({preview:true,...result})
      if(typeof body.requestId!=='string' || !/^[0-9a-f-]{36}$/i.test(body.requestId)) throw new HttpError(400,'Provide a UUID requestId.')
      const previous=await db.query('select flow,asset,version,result from media_flow_execution where org=$1 and id=$2',[orgId,body.requestId])
      if(previous.rowCount){
        const row=previous.rows[0]
        if(row.flow!==flow.id || row.asset!==asset.id || row.version!==flow.version) throw new HttpError(409,'Request ID already used.')
        return json(row.result)
      }
      if(result.tags.length!==asset.tags.length) await db.query('update asset set tags=$2,"updatedAt"=now() where id=$1',[asset.id,result.tags])
      await db.query(`insert into media_flow_execution(org,id,flow,version,name,asset,title,result) values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [orgId,body.requestId,flow.id,flow.version,flow.name,asset.id,asset.title,JSON.stringify(result)])
      return json(result)
    })
  }
  throw new HttpError(404,'Unknown builder endpoint.')
}


export async function advanceBuilderUploads(){
  const db=await pool.connect()
  try{
    await db.query('begin')
    const {rows}=await db.query(`select p.flow,p.version,p.name,p.blocks,a.id,a.title,a.type,a.tags,a.size,a."organizationId" as org
      from media_flow_pending p join asset a on a.id=p.asset
      where a.status='ready' and a."deletedAt" is null and a."takenDown" is null and not exists
      (select 1 from workspace_admin w where w."organizationId"=a."organizationId" and w."suspendedAt" is not null)
      order by a.id,p.flow limit 1 for update of p,a skip locked`)
    if(rows.length){
      const job=rows[0]
      const result=evaluateFlow(job.blocks,job)
      if(result.tags.length!==job.tags.length) await db.query('update asset set tags=$2,"updatedAt"=now() where id=$1',[job.id,result.tags])
      await db.query('insert into media_flow_execution(org,id,flow,version,name,asset,title,result) values($1,$2,$3,$4,$5,$6,$7,$8)',
        [job.org,randomUUID(),job.flow,job.version,job.name,job.id,job.title,JSON.stringify(result)])
      await db.query('delete from media_flow_pending where flow=$1 and asset=$2',[job.flow,job.id])
    }
    await db.query('commit')
  }catch(e){await db.query('rollback');throw e}finally{db.release()}
}
