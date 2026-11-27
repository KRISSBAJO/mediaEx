import {readFile} from 'node:fs/promises'
import {basename} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import sharp from 'sharp'

const [file,device,region,n='5']=process.argv.slice(2), count=Number(n)
if(!file||!device||!region||!Number.isInteger(count)||count<1||count>100)throw Error('Usage: node examples/benchmark-upload.mjs image-file device region samples')
const origin=new URL(process.env.MEDIAEX_URL).origin,key=process.env.MEDIAEX_BENCHMARK_KEY
if(!key||!origin.startsWith('https://'))throw Error('Configure an HTTPS origin and dedicated benchmark workspace key.')
const bytes=await readFile(file)
const api=async(path,method='GET',body)=>{
  const r=await fetch(origin+'/api/v1/'+path,{method,redirect:'error',signal:AbortSignal.timeout(45000),
    headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
  if(!r.ok)throw Error(method+' '+path+' returned '+r.status)
  return r.status===204?null:r.json()
}
const identity=await api('whoami')
if(identity.workspace.id!==process.env.MEDIAEX_BENCHMARK_WORKSPACE||identity.key.scope!=='full')throw Error('Select the dedicated benchmark workspace.')
const samples=[]
for(let i=0;i<count;i++){
  let id
  const start=performance.now()
  try {
    const {asset,upload}=await api('uploads','POST',{fileName:basename(file),size:bytes.length})
    id=asset.id
    const put=async(t,chunk)=>{
      const url=new URL(t.url,origin),headers=new Headers(t.headers)
      if(url.protocol!=='https:')throw Error('Expected HTTPS transfer target.')
      if(url.origin===origin && url.pathname.startsWith('/api/v1/uploads/'+id))headers.set('authorization','Bearer '+key)
      const res=await fetch(url,{method:'PUT',headers,body:chunk,redirect:'error',signal:AbortSignal.timeout(90000)})
      if(!res.ok)throw Error('Transfer returned '+res.status)
    }
    if(upload.kind==='multipart')for(let part=1;part<=upload.partCount;part++){
      const {parts}=await api('uploads/'+id+'/parts','POST',{numbers:[part]})
      await put(parts[0],bytes.subarray((part-1)*upload.partSize,part*upload.partSize))
    }else await put(upload,bytes)
    await api('uploads/'+id+'/complete','POST')
    let delivered=false
    while(performance.now()-start<300000){
      const {asset:a}=await api('assets/'+id)
      if(a.status==='failed')throw Error('Processing failed.')
      if(a.status==='ready'){
        const r=await fetch(new URL(a.thumbUrl,origin),{signal:AbortSignal.timeout(45000)})
        if(!r.ok)throw Error('Thumbnail returned '+r.status)
        await sharp(Buffer.from(await r.arrayBuffer())).resize(1,1).raw().toBuffer()
        delivered=true;break
      }
      await delay(1000)
    }
    if(!delivered)throw Error('Processing timed out.')
    samples.push({ok:true,elapsedMs:Math.round(performance.now()-start)})
  }catch(e){samples.push({ok:false,elapsedMs:Math.round(performance.now()-start),error:e.message})}
  finally{if(id)await api('assets/'+id,'DELETE')}
}
console.log(JSON.stringify({device,region,file:basename(file),bytes:bytes.length,sampleCount:count,node:process.version,samples},null,2))
if(samples.some(s=>!s.ok))process.exitCode=1
