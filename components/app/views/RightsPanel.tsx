'use client'
import {useEffect,useState} from 'react'
import {request} from '../library'
import {Card} from '../ui'

type Policy={revisionId:string;policyGeneration:number;rightsExpireAt:string|null;assignedReviewer:string|null;retired:boolean;reviewers:{id:string;name:string}[]}
export default function RightsPanel({id,onSave}:{id:string;onSave:()=>void}) {
  const [policy,setPolicy]=useState<Policy|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [reviewer,setReviewer]=useState(''),[expiry,setExpiry]=useState(''),[retired,setRetired]=useState(false),[serial,reload]=useState(0)
  useEffect(()=>{
    const abort=new AbortController()
    request<Policy>('/api/assets/'+id+'/rights',{signal:abort.signal}).then(p=>{
      if(abort.signal.aborted)return
      setPolicy(p);setReviewer(p.assignedReviewer??'');setExpiry(p.rightsExpireAt?.slice(0,16)??'');setRetired(p.retired);setError('')
    }).catch(e=>{if(!abort.signal.aborted)setError(e.message)})
    return ()=>abort.abort()
  },[id,serial])
  async function save(){
    if(!policy||busy)return
    setBusy(true)
    try{
      await request('/api/assets/'+id+'/rights',{method:'PUT',json:{revisionId:policy.revisionId,policyGeneration:policy.policyGeneration,
        assignedReviewer:reviewer||null,rightsExpireAt:expiry?new Date(expiry+'Z').toISOString():null,retired}})
      reload(n=>n+1);onSave()
    }catch(e){setError(e instanceof Error?e.message:'Save failed.')}finally{setBusy(false)}
  }
  return <Card title="Rights and reviewer"><div className="stack">
    {error&&<p role="alert">{error} <button onClick={()=>reload(n=>n+1)}>Reload</button></p>}
    {policy&&<><label>Assigned reviewer<select value={reviewer} onChange={e=>setReviewer(e.target.value)}>
      <option value="">Any authorized reviewer</option>{policy.reviewers.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <label>Rights expire at (UTC)<input type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)} /></label>
    <label><input type="checkbox" checked={retired} onChange={e=>setRetired(e.target.checked)} /> Retire this asset</label>
    <small>New delivery requests return unavailable after expiry or retirement.</small>
    <button className="btn btn-primary btn-sm" disabled={busy} onClick={()=>void save()}>Save policy</button>
    <a href="/api/assets/audit?format=ndjson" download>Export workspace audit records</a></>}</div></Card>
}
