'use client'

import Link from 'next/link'
import {useEffect,useState} from 'react'
import {useAccount,canManage} from '@/components/app/account'
import {request} from '@/components/app/library'
import Builder from './Builder'
import Icon from '@/components/app/Icon'
import css from './workflows.module.css'

const base='/api/uploads/workflows'
type Config={enabled:boolean;captions:boolean;captionsAvailable:boolean}
type Run={id:string;title:string;status:string;phase:string;captions:boolean;error:string|null}

function steps(run:Run) {
  const prepared=run.status==='ready'
  const captioned=['review','complete'].includes(run.phase)
  return [
    ['Check upload policy and process', prepared?'Complete':run.status],
    ['Generate captions', !run.captions?'Skipped':captioned?'Complete':run.phase==='captions'?(run.error?'Failed':'In progress'):'Waiting'],
    ['Send to review', run.phase==='complete'?'Complete':run.phase==='review'&&run.error?'Failed':'Waiting']
  ]
}

function WorkspaceWorkflows({manage}:{manage:boolean}) {
  const [config,setConfig]=useState<Config|null>(null)
  const [runs,setRuns]=useState<Run[]>([])
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [revision,refresh]=useState(0)
  const [view,setView]=useState('Flow builder')
  const [filter,setFilter]=useState('All')
  const [query,setQuery]=useState('')
  const filtered=runs.filter(run=>run.title.toLowerCase().includes(query.trim().toLowerCase()) &&
    (filter==='All' || (filter==='Failed' ? Boolean(run.error) : filter==='Complete' ? run.phase==='complete' && !run.error : run.phase!=='complete' && !run.error)))
  useEffect(()=>{
    let active=true
    async function poll(){
      try {
        const [settings,history]=await Promise.all([request<Config>(base),request<{runs:Run[]}>(base+'/runs')])
        if(active){setConfig(settings);setRuns(history.runs)}
      } catch(e){if(active)setMessage(e instanceof Error?e.message:'Could not load workflows.')}
    }
    void poll()
    const timer=setInterval(()=>void poll(),10000)
    return ()=>{active=false;clearInterval(timer)}
  },[revision])
  async function change(path:string,method:string,json?:unknown){
    setBusy(true);setMessage('')
    try {await request(base+path,{method,json});refresh(n=>n+1)}
    catch(e){setMessage(e instanceof Error?e.message:'Request failed.')}
    finally{setBusy(false)}
  }
  const nodes=[
    {icon:'upload',name:'Video uploaded',detail:'Starts on a new video upload'},
    {icon:'shieldCheck',name:'Check policy',detail:'Validate and process the file'},
    ...(config?.captions ? [{icon:'captions',name:'Generate captions',detail:'Transcribe the audio with OpenAI'}] : []),
    {icon:'users',name:'Queue for review',detail:'Hold for a workspace reviewer'}
  ]
  return <main className={css.workbench}>
    <header className={css.heading}><h1>Workflows</h1><Link className={css.link} href="/dashboard/review">Review queue <Icon name="arrowRight" size={15}/></Link></header>
    <nav aria-label="Workflow views" className={css.nav}>
      {['Flow builder','Upload automation','Upload history','API reference'].map(name=><button type="button" key={name} aria-current={view===name?'page':undefined} onClick={()=>setView(name)}>{name}</button>)}
    </nav>
    {message && <p role="alert" className={css.error}>{message}</p>}
    {view==='Flow builder' && <Builder manage={manage}/>} 
    {view==='Upload automation' && <section className={css.panel}>
      <header className={css.panelHead}><div><span className={css.kicker}>Video workflow</span><h2>Omoshow upload review</h2><p>Route new workspace videos through processing and into review.</p></div>
        <span className={css.status} data-active={config?.enabled}>{config?(config.enabled?'Active':'Inactive'):'Loading'}</span></header>
      <ol className={css.canvas} aria-label="Workflow steps">{nodes.map(node=><li key={node.name}>
        <span className={css.icon}><Icon name={node.icon} size={21}/></span><strong>{node.name}</strong><small>{node.detail}</small></li>)}</ol>
      <footer className={css.controls}><div>
        <label><input type="checkbox" checked={config?.captions ?? false} disabled={!manage || busy || !config || (!config.captionsAvailable && !config.captions)}
          onChange={e=>config && void change('/omoshow-upload-review','PUT',{enabled:config.enabled,captions:e.target.checked})}/> Generate captions</label>
        <p>{!config?'Loading workspace settings…':config.captionsAvailable?'OpenAI transcription is configured.':'Set OPENAI_API_KEY on the backend and deploy to use captions.'}</p>
      </div>{manage && <button className={css.action} disabled={!config || busy} onClick={()=>config && void change('/omoshow-upload-review','PUT',{enabled:!config.enabled,captions:config.captions})}>{config?.enabled?'Disable workflow':'Enable workflow'}</button>}</footer>
    </section>}
    {view==='Upload history' && <section className={css.panel}><header className={css.panelHead}><div><h2>Run history</h2><p>Inspect the latest 100 uploads enrolled in this workflow.</p></div></header>
      <div className={css.filters}><input aria-label="Search runs by asset name" placeholder="Search by asset name" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select aria-label="Filter run status" value={filter} onChange={e=>setFilter(e.target.value)}>{['All','In progress','Complete','Failed'].map(v=><option key={v}>{v}</option>)}</select></div>
      {!filtered.length && <div className={css.empty}><Icon name="clock" size={26}/><strong>{!config?'Loading runs…':runs.length?'No matching runs':'No runs yet'}</strong><p>{runs.length?'Try another name or status.':config?.enabled?'The next video upload will appear here.':'Enable the workflow to track new uploads here.'}</p></div>}
      {filtered.map(run=><details key={run.id} className={css.run}><summary>{run.title} <span>{run.error?'Failed':run.phase==='complete'?'Sent to review':run.phase}</span></summary>
        <ol>{steps(run).map(([name,state])=><li key={name}>{name} · {state}</li>)}</ol>
        {run.error && <p>{run.error} {manage && <button disabled={busy} onClick={()=>void change('/runs/'+run.id+'/retry','POST')}>Retry step</button>}</p>}
        <Link className={css.link} href={'/dashboard/library/'+run.id}>Open asset →</Link></details>)}</section>}
    {view==='API reference' && <section className={css.api}><h2>Workflow API</h2>
      <p>Use a workspace API key as a Bearer token. A read key can inspect settings and runs. A full-access key can change the template or retry a failed step.</p>
      <ul>
        <li><code>GET /api/v1/workflows/builder</code> · List manual flows. POST here to create a draft.</li><li><code>PUT /api/v1/workflows/builder/:flowId</code> · Save the next version.</li><li><code>POST /api/v1/workflows/builder/:flowId/test</code> · Preview a saved version on an asset. Use /run to execute with a requestId.</li><li><code>GET /api/v1/workflows/builder/activity</code> · Inspect execution logs.</li><li><code>GET /api/v1/workflows</code> — template settings and caption availability</li>
        <li><code>PUT /api/v1/workflows/omoshow-upload-review</code> — send boolean <code>enabled</code> and <code>captions</code> fields</li>
        <li><code>GET /api/v1/workflows/runs</code> — latest 100 runs</li>
        <li><code>GET /api/v1/workflows/runs/{'{assetId}'}</code> — inspect one run</li>
        <li><code>POST /api/v1/workflows/runs/{'{assetId}'}/retry</code> — retry its failed step</li>
      </ul>
    </section>}
  </main>
}
export default function Workflows(){
  const {workspace}=useAccount()
  return <WorkspaceWorkflows key={workspace.id} manage={canManage(workspace.role)}/>
}
