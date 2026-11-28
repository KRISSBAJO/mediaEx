'use client'

import {useState} from 'react'
import css from './workflows.module.css'

type Operation = {title:string; method:'GET'|'POST'|'PUT'; path:string; description:string; response:unknown; body?:unknown}
const template='omoshow-upload-review'
const definition={name:'Prepare a web image',enabled:false,trigger:'manual',blocks:[{kind:'match-type',value:'image'},{kind:'image-preview',value:'1280/webp'}]}
const saved={...definition,id:'example-flow-id',version:1,scheduleAsset:null}
const assetId='example-asset-id'
const result={steps:[{kind:'match-type',status:'complete',detail:'image'},{kind:'image-preview',status:'complete',detail:'/api/media/example-asset-id/transform?w=1280&f=webp'}],tags:[],notifications:[]}
const run={id:assetId,title:'Example video',status:'ready',phase:'complete',captions:false,error:null,updated:'2026-11-27T12:00:00Z'}
const builder:Operation[]=[
  {title:'List saved flows',method:'GET',path:'/builder',description:'Find flow IDs, versions and configured AI providers.',response:{flows:[saved],providers:{openai:true,anthropic:false,deepseek:false}}},
  {title:'Create a draft',method:'POST',path:'/builder',description:'Save an ordered set of steps as a new workflow.',body:definition,response:{flow:saved}},
  {title:'Update and enable a flow',method:'PUT',path:'/builder/{flowId}',description:'Send the current version with the full definition. A stale version returns 409.',body:{...definition,enabled:true,version:1},response:{flow:{...saved,enabled:true,version:2}}},
  {title:'Test on an asset',method:'POST',path:'/builder/{flowId}/test',description:'Preview each step on a ready asset before applying changes.',body:{version:2,assetId},response:{preview:true,...result}},
  {title:'Run on an asset',method:'POST',path:'/builder/{flowId}/run',description:'Execute an enabled flow. Generate a new UUID per run and reuse it when retrying the same request.',body:{version:2,assetId,requestId:'234ab93a-7144-4a67-bcb7-1cedf1ec1bad'},response:result},
  {title:'Inspect execution history',method:'GET',path:'/builder/activity',description:'Read the latest 100 executions, including each step’s result.',response:{runs:[]}},
  {title:'List parameters',method:'GET',path:'/builder/parameters',description:'Read reusable workspace values for flow definitions.',response:{parameters:[]}},
  {title:'Save a parameter',method:'PUT',path:'/builder/parameters/{name}',description:'Use a lowercase name. Send the previous value when replacing a parameter, or null when creating one.',body:{value:'editorial',previous:null},response:{name:'review_tag',value:'editorial'}},
  {title:'Read usage',method:'GET',path:'/builder/usage?days=30',description:'Count executions, distinct assets, steps and notifications over 7, 30 or 90 days.',response:{days:30,usage:{executions:0,assets:0,steps:0,notifications:0}}},
  {title:'Draft with AI',method:'POST',path:'/builder/agent',description:'Send a prompt to a configured provider. Review the returned draft before saving.',body:{provider:'openai',prompt:'Prepare a 1280px WebP preview of images.'},response:{draft:{...definition,scheduleAsset:null}}}
]
const review:Operation[]=[
  {title:'Read upload settings',method:'GET',path:'',description:'Check whether automatic review is enabled and captions are available.',response:{template,enabled:true,captions:false,captionsAvailable:true}},
  {title:'Change upload automation',method:'PUT',path:'/'+template,description:'Choose whether new videos enter review and whether to generate captions.',body:{enabled:true,captions:false},response:{template,enabled:true,captions:false}},
  {title:'List upload runs',method:'GET',path:'/runs',description:'Read the latest 100 enrolled uploads.',response:{runs:[run]}},
  {title:'Inspect one upload',method:'GET',path:'/runs/{assetId}',description:'Look up the current phase and any error for an enrolled asset.',response:{runs:[run]}},
  {title:'Retry a failed step',method:'POST',path:'/runs/{assetId}/retry',description:'Resume an eligible failed step. A caption retry queues the step again.',response:{queued:true}}
]

function Endpoint({op}:{op:Operation}) {
  const [message,setMessage]=useState('')
  const path='/api/v1/workflows'+op.path
  const shellPath=path.replace('{flowId}','$FLOW_ID').replace('{assetId}','$ASSET_ID').replace('{name}','review_tag')
  const lines=['curl -X '+op.method+' "$MEDIAEX_URL'+shellPath+'"','  -H "Authorization: Bearer $MEDIAEX_API_KEY"']
  if(op.body) lines.push('  -H "Content-Type: application/json"', "  --data '"+JSON.stringify(op.body)+"'")
  const command=lines.join(' '+String.fromCharCode(92,10))
  async function copy(){
    try {await navigator.clipboard.writeText(command);setMessage('Request copied')}
    catch {setMessage('Select the request below and copy it manually.')}
  }
  return <details className={css.endpoint}><summary><code>{op.method}</code><strong>{op.title}</strong><span>{op.method==='GET'?'Read key':'Full-access key'}</span></summary>
    <div><code className={css.path}>{path}</code><p>{op.description}</p>
    <header><h4>Request</h4><button onClick={copy}>Copy request</button></header>
    {message && <small role="status">{message}</small>}<pre>{command}</pre><h4>Example response</h4><pre>{JSON.stringify(op.response,null,2)}</pre></div></details>
}
export default function ApiReference(){
  return <section className={css.reference}><h2>Workflow API</h2><p>Set <code>MEDIAEX_URL</code> to your MediaEX base URL and <code>MEDIAEX_API_KEY</code> to your workspace key in your server environment. Set the flow or asset ID where required and replace example JSON values with your own.</p>
    {([['Build a flow',builder],['Manage upload review',review]] as const).map(([title,operations])=><section key={title}><h3>{title}</h3>{operations.map(op=><Endpoint key={op.title} op={op}/>)}</section>)}</section>
}
