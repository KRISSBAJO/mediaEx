import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {MEDIA_SCHEMA} from '../backend/media/schema.mts'
import {RECOVERY_SCHEMA} from '../backend/media/recovery-schema.mts'
import {OPERATIONS_SCHEMA} from '../backend/media/operations-schema.mts'
await mkdir('.media',{recursive:true})
const dir=await mkdtemp(path.resolve('.media/phase2-sql-'))
const run=(cmd,args,input)=>{
  const r=spawnSync(cmd,args,{input,encoding:'utf8',maxBuffer:32*1024*1024})
  if(r.error||r.status!==0||/(?:ERROR|FATAL|PANIC):/.test(r.stderr))throw Error(r.error?.message??r.stderr.slice(-3000))
  return r.stdout
}
try{
  const pass=path.join(dir,'pw'),db=path.join(dir,'db')
  await writeFile(pass,randomUUID(),{mode:0o600})
  run('initdb',['-D',db,'-U','dev','-A','scram-sha-256','--pwfile='+pass,'--encoding=UTF8','--locale=C','--no-sync'])
  const sql=s=>run('postgres',['--single','-D',db,'postgres'],s.replace(/--[^\n]*/g,'').replace(/\s+/g,' ')+'\n')
  sql('create table organization(id text primary key);create table "user"(id text primary key);create table member(id text primary key,"organizationId" text,"userId" text,role text);')
  sql(MEDIA_SCHEMA)
  sql(RECOVERY_SCHEMA);sql(RECOVERY_SCHEMA)
  sql(OPERATIONS_SCHEMA)
  sql(`insert into organization values ('qa');insert into api_key(id,"organizationId",name,scope,hash,last4) values('key','qa','omoshow','publish','sample','test');`)
  assert.match(sql("select mediaex_charge_key('key','sample',1) as first_charge"),/first_charge = "0"/)
  assert.match(sql("select (mediaex_charge_key('key','sample',1)>0)::text as limited"),/limited = "true"/)
  assert.match(sql("select mediaex_charge_key('key','wrong',1) as revoked"),/revoked = "-1"/)
  sql(`insert into member values('m','qa','alice','reviewer');
    insert into asset_review_event ("organizationId","assetId","revisionId",state,actor,comment)
    values ('qa','ast_sample','00000000-0000-4000-8000-000000000001','approved','user:alice','crop reviewed');
    insert into media_reference_event ("organizationId",application,resource,slot,generation,actor,reason)
    values ('qa','omoshow','event:one','cover',1,'key:key','detach');
    update api_key set hash='changed' where id='key';`)
  assert.match(sql("select count(*) as audit_events from governance_audit"),/audit_events = "5"/)
  assert.ok(!sql("select details from governance_audit where action='key.rotated'").includes('changed'))
  console.log('PostgreSQL migration replay, shared rate limit, rotation and audit triggers passed.')
}finally{await rm(dir,{recursive:true,force:true})}
