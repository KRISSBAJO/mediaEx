'use client'
import {useEffect,useState} from 'react'
import {request} from '@/components/app/library'
import css from './workflows.module.css'

const base='/api/uploads/workflows/builder'
export function Usage(){
  const [days,setDays]=useState(30)
  const [data,setData]=useState<Record<string,number>|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    let current=true
    setData(null);setError('')
    request<{usage:Record<string,number>}>(base+'/usage?days='+days).then(r=>{if(current)setData(r.usage)}).catch(e=>{if(current)setError(e.message)})
    return ()=>{current=false}
  },[days])
  return <><div className={css.heading}><h2>Workflow usage</h2><select aria-label="Reporting period" value={days} onChange={e=>setDays(Number(e.target.value))}>{[7,30,90].map(n=><option key={n} value={n}>Last {n} days</option>)}</select></div>
    {error && <p role="alert">{error}</p>}<div className={css.tiles}>{['executions','assets','steps','notifications'].map(k=><div className={css.tile} key={k}><span>{k}</span><strong>{data?data[k]:'…'}</strong></div>)}</div></>
}
export function Parameters({manage}:{manage:boolean}){
  const [items,setItems]=useState<{name:string;value:string}[]>([])
  const [name,setName]=useState(''),[value,setValue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{let current=true;request<{parameters:typeof items}>(base+'/parameters').then(r=>{if(current)setItems(r.parameters)}).catch(e=>{if(current)setError(e.message)});return ()=>{current=false}},[])
  async function save(){
    setBusy(true);setError('')
    try{
      const item=await request<{name:string;value:string}>(base+'/parameters/'+encodeURIComponent(name),{method:'PUT',json:{value,previous:items.find(i=>i.name===name)?.value??null}})
      setItems(prev=>[...prev.filter(i=>i.name!==item.name),item]);setName('');setValue('')
    }catch(e){setError(e instanceof Error?e.message:'Could not save parameter.')}finally{setBusy(false)}
  }
  return <section className={css.test}><h2>Workspace parameters</h2><p>Store shared labels and messages here. Workspace members can read them. Use <code>{'{{name}}'}</code> in a tag or message to copy its value into a flow when you save. Keep provider credentials in Hoist.</p>
    {items.map(p=><div className={css.heading} key={p.name}><code>{p.name}</code><span>{p.value}</span>{manage && <button onClick={()=>{setName(p.name);setValue(p.value)}}>Edit</button>}</div>)}
    {manage && <><label>Name <input value={name} maxLength={40} placeholder="review_tag" onChange={e=>setName(e.target.value)}/></label><label>Value <input value={value} maxLength={80} onChange={e=>setValue(e.target.value)}/></label>
    <button disabled={busy||!name||!value.trim()} onClick={save}>Save parameter</button></>}{error && <p role="alert">{error}</p>}</section>
}

