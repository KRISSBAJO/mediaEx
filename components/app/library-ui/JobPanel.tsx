'use client'
import { useEffect,useState } from 'react'
import { request } from '../library'
type Job = {state:string;total:number;done:number;failed:number;field:string;value:unknown}
type Item = {before_value:unknown;asset:string;status:string;error:string|null}
export default function JobPanel({id,onClose}:{id:string;onClose:()=>void}) {
  const [data,setData]=useState<{jobs:Job[];items:Item[]}|null>(null)
  const [error,setError]=useState('')
  const [refresh,setRefresh]=useState(0)
  useEffect(()=>{
    const abort=new AbortController()
    let timer:ReturnType<typeof setTimeout>
    const poll=async()=>{
      try {
        const result=await request<{jobs:Job[];items:Item[]}>('/api/assets/jobs/'+id,{signal:abort.signal})
        if(abort.signal.aborted)return
        setData(result);setError('')
        if(result.jobs[0]?.state==='running')timer=setTimeout(poll,1000)
      } catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Could not load job.')}
    }
    void poll()
    return ()=>{abort.abort();clearTimeout(timer)}
  },[id,refresh])
  const change=async(method:string)=>{
    try{await request('/api/assets/jobs/'+id,{method});setRefresh(v=>v+1)}catch(e){setError(e instanceof Error?e.message:'Job update failed.')}
  }
  const job=data?.jobs[0]
  return <section className="card"><h3>Bulk metadata edit</h3>{error&&<p role="alert">{error}</p>}
    {job&&<><p>{job.state} · {job.total} selected · {job.done} updated · {job.failed} failed</p>
    <p>{job.field} → {JSON.stringify(job.value)}</p>
    {job.state==='preview'&&<button className="btn btn-primary" onClick={()=>void change('PATCH')}>Apply edit</button>}
    {['preview','running'].includes(job.state)&&<button className="btn btn-quiet" onClick={()=>void change('DELETE')}>Cancel job</button>}
    <details><summary>Per-asset results</summary><ul>{data?.items.map(item=><li key={item.asset}>{item.asset} · {JSON.stringify(item.before_value)} → {JSON.stringify(job.value)} · {item.status} {item.error}</li>)}</ul></details></>}
    <button className="btn btn-quiet" onClick={onClose}>Close</button></section>
}
