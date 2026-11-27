import {pool} from '../auth.mts'

// Keep redirected storage requests separate. Their transfer takes place outside the MediaEX process.
export function meterDelivery(org:string,method:string,res:Response) {
  if(method!=='GET')return res
  const redirect=[301,302,303,307,308].includes(res.status)
  const record=async(bytes:number)=>{
    try{
      await pool.query(`insert into media_delivery_day(org,day,bytes,responses,redirects)
        values ($1,(now() at time zone 'UTC')::date,$2,$3,$4) on conflict(org,day) do update set
        bytes=media_delivery_day.bytes+excluded.bytes,responses=media_delivery_day.responses+excluded.responses,
        redirects=media_delivery_day.redirects+excluded.redirects`,[org,bytes,redirect?0:1,redirect?1:0])
    }catch{console.warn('[media] Could not record delivery usage.')}
  }
  if(redirect){void record(0);return res}
  if(!res.ok||!res.body)return res
  const reader=res.body.getReader()
  let bytes=0,finished=false
  const finish=()=>{if(!finished){finished=true;void record(bytes)}}
  const stream=new ReadableStream<Uint8Array>({
    async pull(controller){
      try{
        const chunk=await reader.read()
        if(chunk.done){finish();controller.close();return}
        bytes+=chunk.value.byteLength
        controller.enqueue(chunk.value)
      }catch(error){finish();controller.error(error)}
    },
    async cancel(reason){try{await reader.cancel(reason)}finally{finish()}}
  })
  return new Response(stream,{status:res.status,statusText:res.statusText,headers:res.headers})
}
