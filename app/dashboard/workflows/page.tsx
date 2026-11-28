'use client'

import Link from 'next/link'
import {useEffect,useState} from 'react'
import {useAccount,canManage} from '@/components/app/account'
import {request} from '@/components/app/library'
import {PageHead,Card} from '@/components/app/ui'

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
  return <>
    <PageHead title="Workflows" sub="Choose how new video uploads reach your review queue."/>
    {message && <p role="alert">{message}</p>}
    <Card title="Workflow templates">
      <details open><summary><strong>Prepare an Omoshow upload for review</strong></summary>
        <p>Check the upload policy, optionally generate captions, then send the video to review. Applies to new videos in this workspace.</p>
        {config ? <>
          <label><input type="checkbox" checked={config.captions} disabled={!manage || busy || (!config.captionsAvailable && !config.captions)}
            onChange={e=>void change('/omoshow-upload-review','PUT',{enabled:config.enabled,captions:e.target.checked})}/> Generate captions</label>
          {!config.captionsAvailable && <p>Automatic captions need OPENAI_API_KEY on the backend.</p>}
          <p>{config.enabled?'Enabled for new uploads':'Disabled'} {manage && <button className="btn btn-secondary btn-sm" disabled={busy}
            onClick={()=>void change('/omoshow-upload-review','PUT',{enabled:!config.enabled,captions:config.captions})}>{config.enabled?'Disable workflow':'Enable workflow'}</button>}</p>
        </> : <p>Loading settings…</p>}
      </details>
    </Card>
    <Card title="Recent runs" action={<Link href="/dashboard/review">Open review queue →</Link>}>
      {!runs.length && <p>{config?'No workflow runs yet. Enable the template and upload a video to see its progress.':'Loading runs…'}</p>}
      {runs.map(run=><details key={run.id}><summary>{run.title} · {run.error?'Failed':run.phase==='complete'?'Sent to review':run.phase}</summary>
        <ol>{steps(run).map(([name,state])=><li key={name}>{name} · {state}</li>)}</ol>
        {run.error && <p>{run.error} {manage && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>void change('/runs/'+run.id+'/retry','POST')}>Retry step</button>}</p>}
        <Link href={'/dashboard/library/'+run.id}>Open asset →</Link>
      </details>)}
    </Card>
    <details><summary>Workflow API</summary>
      <p>Use a workspace API key as a Bearer token. A read key can inspect settings and runs. A full-access key can change the template or retry a failed step.</p>
      <ul>
        <li><code>GET /api/v1/workflows</code> — template settings and caption availability</li>
        <li><code>PUT /api/v1/workflows/omoshow-upload-review</code> — send boolean <code>enabled</code> and <code>captions</code> fields</li>
        <li><code>GET /api/v1/workflows/runs</code> — latest 100 runs</li>
        <li><code>GET /api/v1/workflows/runs/{'{assetId}'}</code> — inspect one run</li>
        <li><code>POST /api/v1/workflows/runs/{'{assetId}'}/retry</code> — retry its failed step</li>
      </ul>
    </details>
  </>
}
export default function Workflows(){
  const {workspace}=useAccount()
  return <WorkspaceWorkflows key={workspace.id} manage={canManage(workspace.role)}/>
}
