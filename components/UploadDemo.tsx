'use client'

import styles from './UploadDemo.module.css'
import Link from 'next/link'
import {useEffect,useRef,useState} from 'react'
import type {MediaAsset} from '@/lib/media/types'

type Target={url:string;method:string;headers?:Record<string,string>}
type Plan=Target|{kind:'multipart';parts:string;partCount:number;partSize:number}
type Receipt={event:string;status:string;attempts:number}
export default function UploadDemo(){
  const [file,setFile]=useState<File|null>(null),[asset,setAsset]=useState<MediaAsset|null>(null)
  const [trace,setTrace]=useState<string[]>([]),[receipts,setReceipts]=useState<Receipt[] | null>(null),[busy,setBusy]=useState(false)
  const [error,setError]=useState(''),[signin,setSignin]=useState(false)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>controller.current?.abort(),[])
  async function run() {
    if(!file||busy)return
    const abort=new AbortController()
    controller.current=abort
    setBusy(true);setError('');setTrace([]);setReceipts(null);setAsset(null);setSignin(false)
    const add=(line:string)=>setTrace(prev=>[...prev,line])
    const api=async(url:string,data?:unknown)=>{
      const res=await fetch(url,{method:data===undefined?'GET':'POST',signal:abort.signal,cache:'no-store',
        headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)})
      const value=await res.json().catch(()=>({}))
      if(res.status===401)setSignin(true)
      if(!res.ok)throw Error(value.error??'Request failed ('+res.status+').')
      return value
    }
    try {
      add('POST /api/uploads')
      const created=await api('/api/uploads',{fileName:file.name,mimeType:file.type,size:file.size})
      setAsset(created.asset)
      const plan:Plan=created.upload
      const transfer=async(target:Target,bytes:Blob)=>{
        const res=await fetch(target.url,{method:target.method,headers:target.headers,body:bytes,signal:abort.signal})
        if(!res.ok)throw Error('Transfer failed ('+res.status+').')
      }
      if('kind' in plan&&plan.kind==='multipart'){
        for(let number=1;number<=plan.partCount;number++){
          const {parts}=await api(plan.parts,{numbers:[number]})
          await transfer(parts[0],file.slice((number-1)*plan.partSize,number*plan.partSize))
        }
      }else await transfer(plan as Target,file)
      add('Transferred '+file.size.toLocaleString()+' bytes')
      await api('/api/uploads/'+created.asset.id+'/complete',{})
      add('POST /api/uploads/'+created.asset.id+'/complete')
      for(let attempt=0;attempt<180;attempt++){
        const {asset:updated}=await api('/api/assets/'+created.asset.id)
        setAsset(updated)
        if(updated.status==='failed')throw Error(updated.error??'Processing failed.')
        if(updated.status==='ready'){
          add('GET /api/assets/'+updated.id+' → ready')
          const result = await fetch('/api/assets/'+updated.id+'/delivery-events', {signal: abort.signal, cache: 'no-store'}).catch(() => null)
          if (result?.ok) {
            const data = await result.json().catch(() => null)
            if (Array.isArray(data?.events)) setReceipts(data.events)
          }
          return
        }
        await new Promise(resolve=>setTimeout(resolve,2000))
      }
      throw Error('Processing continues. Open the asset to see its latest status.')
    }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Upload failed.')}
    finally{if(!abort.signal.aborted)setBusy(false)}
  }
  return <div id="live-upload" className={styles.panel}>
    <label className={styles.picker}>
      <input type="file" aria-label="Choose image or video" accept="image/*,video/*" disabled={busy}
        onChange={e => setFile(e.target.files?.[0] ?? null)} />
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </svg>
      <strong>{file ? file.name : 'Choose an image or video'}</strong>
      <small>{file ? 'Choose a different file' : 'Browse files on your device'}</small>
    </label>
    <div className={styles.actions}>
      <p>Uploads use storage in your signed-in workspace.</p>
      <button type="button" disabled={!file || busy} onClick={() => void run()}>
        {busy ? 'Processing…' : 'Upload file'}
      </button>
    </div>
    {error&&<p role="alert">{error}</p>}{signin&&<Link href="/sign-in?next=%2F%23live-upload">Sign in to try the upload</Link>}
    {!!trace.length&&<ol>{trace.map((line,i)=><li key={i}><code>{line}</code></li>)}</ol>}
    {asset&&<p><Link href={'/dashboard/library/'+asset.id}>{asset.fileName}</Link> · {asset.status}</p>}
    {asset?.thumbUrl&&<img src={asset.thumbUrl} alt="Delivered thumbnail" style={{maxWidth:'100%',maxHeight:240}} />}
    {asset?.playbackUrl&&<iframe title="Uploaded video playback" src={'/embed/'+asset.id} style={{width:'100%',aspectRatio:'16/9',border:0}} />}
    {asset?.status==='ready'&&receipts&&<p>Webhooks · {receipts.length?receipts.map(r=>r.event+' '+r.status+' ('+r.attempts+' attempts)').join(', '):'No delivery recorded for this asset.'}</p>}
  </div>
}
