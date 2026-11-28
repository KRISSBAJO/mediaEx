'use client'

import Link from 'next/link'
import {useEffect,useState} from 'react'
import {request} from '@/components/app/library'
import Icon from '@/components/app/Icon'
import {Usage,Parameters} from './FlowSettings'
import css from './workflows.module.css'

const base='/api/uploads/workflows/builder'
const labels={inspect:'Read asset information','image-preview':'Create a resized image link','read-tags':'Read tags','asset-link':'Get library link',otherwise:'Otherwise','end-if':'End condition','match-type':'If media type matches','match-tag':'If asset has tag','add-tag':'Add a tag',log:'Write a log entry',notify:'Add a workflow notification',webhook:'Send subscribed webhook'}
type Kind=keyof typeof labels
type Block={kind:Kind;value:string}
type Flow={scheduleAsset?:string|null;trigger?:string;id?:string;name:string;enabled:boolean;version:number;blocks:Block[]}
type Result={steps:{kind:Kind;status:string;detail:string}[];notifications:string[]}
type Execution={id:string;name:string;title:string;created:string;result:Result}
const block=(kind:Kind,value=''):Block=>({kind,value})
const templates=[
  {name:'Prepare a web image',blocks:[block('match-type','image'),block('image-preview','1280/webp')]},
  {name:'Inspect an asset',blocks:[block('inspect'),block('log','Asset inspected')]},
  {name:'Tag a video',blocks:[block('match-type','video'),block('add-tag','video-library')]},
  {name:'Flag tagged assets',blocks:[block('match-tag','needs-review'),block('notify','This asset needs review')]}
]

export default function Builder({manage}:{manage:boolean}){
  const [flows,setFlows]=useState<Flow[]>([])
  const [activity,setActivity]=useState<Execution[]>([])
  const [assets,setAssets]=useState<{id:string;title:string;status:string}[]>([])
  const [draft,setDraft]=useState<Flow|null>(null)
  const [dirty,setDirty]=useState(false)
  const [assetId,setAsset]=useState('')
  const [result,setResult]=useState<Result|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [mode,setMode]=useState('My flows')
  const [search,setSearch]=useState('')
  const [loaded,setLoaded]=useState(false)
  const [providers,setProviders]=useState<Record<string,boolean>>({})
  const [provider,setProvider]=useState('openai')
  const [prompt,setPrompt]=useState('')
  async function generate(){
    setBusy(true);setError('')
    try{
      const {draft}=await request<{draft:Flow}>(base+'/agent',{method:'POST',json:{provider,prompt}})
      open({...draft,version:0,enabled:false})
    }catch(e){setError(e instanceof Error?e.message:'Could not generate a draft.')}finally{setBusy(false)}
  }
  useEffect(()=>{
    let active=true
    Promise.all([request<{flows:Flow[];providers:Record<string,boolean>}>(base),request<{runs:Execution[]}>(base+'/activity'),request<{assets:typeof assets}>('/api/assets?limit=100')])
      .then(([f,r,a])=>{if(active){setFlows(f.flows);setProviders(f.providers);setActivity(r.runs);setAssets(a.assets.filter(x=>x.status==='ready'));setLoaded(true)}})
      .catch(e=>{if(active)setError(e.message)})
    return ()=>{active=false}
  },[])
  function edit(next:Flow){setDraft(next);setDirty(true);setResult(null);setNotice('')}
  function open(flow:Flow){setDraft(flow);setDirty(!flow.id);setResult(null);setNotice('');setError('');setAsset('')}
  async function save(){
    if(!draft)return
    setBusy(true);setError('')
    try{
      const {flow}=await request<{flow:Flow}>(base+(draft.id?'/'+draft.id:''),{method:draft.id?'PUT':'POST',json:draft})
      setFlows(old=>[flow,...old.filter(x=>x.id!==flow.id)]);setDraft(flow);setDirty(false);setNotice('Saved version '+flow.version)
    }catch(e){setError(e instanceof Error?e.message:'Save failed.')}finally{setBusy(false)}
  }
  async function execute(test:boolean){
    if(!draft?.id || !assetId || dirty)return
    setBusy(true);setError('');setResult(null);setNotice('')
    try{
      const output=await request<Result>(base+'/'+draft.id+(test?'/test':'/run'),{method:'POST',json:{assetId,version:draft.version,requestId:crypto.randomUUID()}})
      setResult(output);setNotice(test?'Test finished. Asset unchanged.':'Run complete.')
      if(!test)setActivity((await request<{runs:Execution[]}>(base+'/activity')).runs)
    }catch(e){setError(e instanceof Error?e.message:'Execution failed.')}finally{setBusy(false)}
  }
  const log=(r:Result)=><ol className={css.trace}>{r.steps.map((s,i)=><li key={i}><strong>{labels[s.kind]}</strong><span>{s.status} · {s.status==='complete' && ['asset-link','image-preview'].includes(s.kind)?<a className={css.link} href={s.detail} target="_blank" rel="noreferrer">Open {s.kind==='image-preview'?'resized image':'library asset'} ↗</a>:s.detail}</span></li>)}</ol>
  return <section className={css.builder}>
    {error && <p role="alert" className={css.error}>{error}</p>}
    {draft ? <><header className={css.heading}><button disabled={busy} onClick={()=>{setDraft(null);setNotice('')}}>{dirty?'Discard edits and close':'Back to flows'}</button><span>Version {draft.version}</span></header>
      <fieldset className={css.editor} disabled={!manage||busy}><legend>Flow editor</legend>
        <label>Flow name<input value={draft.name} maxLength={100} onChange={e=>edit({...draft,name:e.target.value})}/></label>
        <label>Trigger<select value={draft.trigger??'manual'} onChange={e=>edit({...draft,trigger:e.target.value})}><option value="manual">Manual run on a library asset</option><option value="upload">When a new upload finishes processing</option><option value="daily">Every 24 hours on one asset</option></select></label>
        {draft.trigger==='daily' && <label>Scheduled asset<select value={draft.scheduleAsset??''} onChange={e=>edit({...draft,scheduleAsset:e.target.value})}><option value="">Choose a ready asset</option>{assets.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label>}
        {draft.blocks.map((b,i)=><div className={css.block} key={i}><label>Action {i+1}<select value={b.kind} onChange={e=>edit({...draft,blocks:draft.blocks.map((v,j)=>i===j?block(e.target.value as Kind,e.target.value==='match-type'?'video':e.target.value==='image-preview'?'1280/webp':''):v)})}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
          {!['inspect','read-tags','asset-link','otherwise','end-if'].includes(b.kind) && <label>{b.kind==='image-preview'?'Width / format (e.g. 1280/webp)':b.kind==='match-type'?'Media type':b.kind.includes('tag')?'Tag':'Message'}<input value={b.value} maxLength={b.kind.includes('tag')?40:200} placeholder={b.kind==='match-type'?'video, image, or audio':undefined} onChange={e=>edit({...draft,blocks:draft.blocks.map((v,j)=>i===j?{...v,value:e.target.value}:v)})}/></label>}
          <button type="button" disabled={i===0} aria-label={'Move action '+(i+1)+' up'} onClick={()=>{const copy=[...draft.blocks];[copy[i-1],copy[i]]=[copy[i],copy[i-1]];edit({...draft,blocks:copy})}}>↑</button>
          <button type="button" aria-label={'Remove action '+(i+1)} onClick={()=>edit({...draft,blocks:draft.blocks.filter((_,j)=>j!==i)})}>Remove</button></div>)}
        <button disabled={draft.blocks.length>=20} onClick={()=>edit({...draft,blocks:[...draft.blocks,block('inspect')]})}>Add action</button>
        <label><input type="checkbox" checked={draft.enabled} onChange={e=>edit({...draft,enabled:e.target.checked})}/> Enable workflow</label>
        <button className={css.action} disabled={!dirty||!draft.name.trim()||!draft.blocks.length} onClick={save}>Save flow</button>
      </fieldset>
      {manage && <div className={css.test}><h3>Test on a library asset</h3><p>Preview the steps before applying them. Save your edits to test this version.</p>
        <select aria-label="Library asset" value={assetId} onChange={e=>{setAsset(e.target.value);setResult(null);setNotice('')}}><option value="">Choose a ready asset</option>{assets.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select>
        <button disabled={!assetId||dirty||busy} onClick={()=>void execute(true)}>Test flow</button><button disabled={!assetId||dirty||busy||!draft.enabled} onClick={()=>void execute(false)}>Run on asset</button></div>}
      {notice && <p role="status">{notice}</p>}{result && log(result)}</> :
      <><div className={css.filters}>{['My flows','Templates','Workflow agent','Activity','Notifications','Connections','Parameters','Usage'].map(m=><button key={m} aria-pressed={mode===m} onClick={()=>{setMode(m);setSearch('')}}>{m}</button>)}</div>
        {mode==='My flows' && <><div className={css.heading}><h2>My flows</h2>{manage && <button className={css.action} onClick={()=>open({name:'Untitled flow',blocks:[block('inspect')],enabled:false,version:0})}>Create flow</button>}</div>
        {!!flows.length && <input aria-label="Search flows" placeholder="Search flows" value={search} onChange={e=>setSearch(e.target.value)}/>}
        {flows.filter(f=>f.name.toLowerCase().includes(search.toLowerCase())).map(f=><button key={f.id} className={css.tile} onClick={()=>open(f)}><strong>{f.name}</strong><span>{f.enabled?'Active':'Draft'} · {f.blocks.length} steps</span></button>)}
        {!flows.length && <p>{loaded?'Create a manual flow or choose a template to start.':'Loading flows…'}</p>}</>}
        {(mode==='Templates'||mode==='My flows') && <section className={css.gallery}><h3>Start from a template</h3><div className={css.tiles}>{templates.map(t=><button key={t.name} disabled={!manage} className={css.tile} onClick={()=>open({...t,enabled:false,version:0})}><span className={css.icon}><Icon name={t.name.includes('video')?'film':t.name.includes('Flag')?'alert':'file'}/></span><strong>{t.name}</strong><span>{t.blocks.map(b=>labels[b.kind]).join(' → ')}</span></button>)}</div></section>}
        {mode==='Workflow agent' && <div className={css.test}><h2>Draft a workflow</h2>
          <p>Send a description to the selected provider. Review and save its suggested steps before running.</p>
          <label>Provider <select value={provider} onChange={e=>setProvider(e.target.value)}>{Object.entries(providers).map(([key,available])=><option key={key} value={key}>{key} · {available?'Configured':'Key missing'}</option>)}</select></label>
          <label>Describe your workflow<textarea rows={3} maxLength={2000} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Tag new videos for editorial review"/></label>
          <button className={css.action} disabled={!manage||busy||!prompt.trim()||!providers[provider]} onClick={generate}>Generate draft</button></div>}
        {mode==='Usage' && <Usage/>}
        {mode==='Connections' && <div className={css.test}><h2>Connections</h2>{Object.entries(providers).map(([name,ok])=><p key={name}><strong>{name}</strong> · {ok?'Key configured':'Key missing'}</p>)}<p>Webhook steps deliver to enabled endpoints subscribed to <code>workflow.notification</code>.</p><Link className={css.link} href="/dashboard/developers">Manage webhook endpoints →</Link><Link className={css.link} href="/dashboard/usage">Storage and S3 →</Link></div>}
        {mode==='Parameters' && <Parameters manage={manage}/>}
        {mode==='Activity' && <>{!activity.length && <p>No manual runs yet.</p>}{activity.map(r=><details className={css.run} key={r.id}><summary>{r.name} · {r.title}</summary><small>{new Date(r.created).toLocaleString()}</small>{log(r.result)}</details>)}</>}
        {mode==='Notifications' && <>{!activity.some(r=>r.result.notifications.length) && <p>No notifications in the latest 100 runs.</p>}{activity.flatMap(r=>r.result.notifications.map((n,i)=><p key={r.id+i}><strong>{r.title}</strong> · {n}</p>))}</>}
      </>}
  </section>
}
