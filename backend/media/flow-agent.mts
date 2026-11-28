import { pool } from '../auth.mts'
import { HttpError } from './assets.mts'

export function flowProviders() {
  return {openai:Boolean(process.env.OPENAI_API_KEY),anthropic:Boolean(process.env.ANTHROPIC_API_KEY),deepseek:Boolean(process.env.DEEPSEEK_API_KEY)}
}

export async function draftFlow(org:string,provider:unknown,prompt:unknown) {
  if(provider!=='openai' && provider!=='anthropic' && provider!=='deepseek') throw new HttpError(400,'Choose a supported provider.')
  if(typeof prompt!=='string' || !prompt.trim() || prompt.length>2000) throw new HttpError(400,'Describe the workflow in up to 2000 characters.')
  if(!flowProviders()[provider]) throw new HttpError(409,'This provider is not configured on the backend.')
  const quota=await pool.query(`insert into flow_agent_usage(org,bucket,requests) values($1,date_trunc('hour',now()),1)
    on conflict(org) do update set bucket=excluded.bucket, requests=case when flow_agent_usage.bucket=excluded.bucket then flow_agent_usage.requests+1 else 1 end
    where flow_agent_usage.bucket<>excluded.bucket or flow_agent_usage.requests<12 returning requests`,[org])
  if(!quota.rowCount) throw new HttpError(429,'This workspace has used its hourly workflow draft allowance.')
  const system='Return only a JSON object with name and blocks. Blocks are ordered objects with kind and value strings. Allowed kinds: inspect (empty value), match-type (image, video, audio), match-tag, add-tag, log, notify (in-app only). Conditions skip all remaining blocks if false. No network, deletion, captions, or transformations are available in this builder. If the request cannot be implemented using only those blocks return {"unsupported":true}. Do not invent actions.'
  const claude=provider==='anthropic'
  const url=claude?'https://api.anthropic.com/v1/messages':provider==='openai'?'https://api.openai.com/v1/chat/completions':'https://api.deepseek.com/chat/completions'
  const model=claude?(process.env.ANTHROPIC_MODEL||'claude-haiku-4-5'):(provider==='openai'?(process.env.OPENAI_MODEL||'gpt-4.1-mini'):(process.env.DEEPSEEK_MODEL||'deepseek-flash'))
  const headers:Record<string,string>={'Content-Type':'application/json'}
  if(claude){headers['x-api-key']=process.env.ANTHROPIC_API_KEY!;headers['anthropic-version']='2023-06-01'}
  else headers.Authorization='Bearer '+(provider==='openai'?process.env.OPENAI_API_KEY:process.env.DEEPSEEK_API_KEY)
  const user={role:'user',content:prompt}
  let output
  try {
    const response=await fetch(url,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(30000),body:JSON.stringify(claude?
      {model,max_tokens:900,system,messages:[user]}:{model,max_tokens:900,messages:[{role:'system',content:system},user]})})
    if(!response.ok) throw new HttpError(502,'The provider rejected the request (HTTP '+response.status+'). Check the configured key, model and balance.')
    const data=await response.json()
    const content=claude?data.content?.find((x:{type:string})=>x.type==='text')?.text:data.choices?.[0]?.message?.content
    output=JSON.parse(String(content??'').trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/g,''))
  } catch(e){if(e instanceof HttpError)throw e;throw new HttpError(502,'The provider did not return a usable workflow draft.')}
  if(!output || output.unsupported) throw new HttpError(422,'This request needs a block that the builder does not support yet.')
  return output
}

