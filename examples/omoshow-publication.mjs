// Server-side integration. The application owns event authorization and approval.
export function publicationClient({ origin, key, application, fetchImpl=fetch }) {
  const base=new URL(origin)
  if(base.protocol!=='https:' && !['localhost','127.0.0.1'].includes(base.hostname))throw Error('Use HTTPS for the MediaEX API.')
  const endpoint=(resource,slot)=>{
    const url=new URL('/api/v1/references',base)
    url.search=new URLSearchParams({application,resource,slot}).toString()
    return url
  }
  const request=async(url,method,body)=>{
    const res=await fetchImpl(url,{method,headers:{authorization:'Bearer '+key,'content-type':'application/json'},
      redirect:'error',signal:AbortSignal.timeout(15000),body:body===undefined?undefined:JSON.stringify(body)})
    const value=await res.json()
    if(!res.ok)throw Object.assign(Error(value.error??'MediaEX request failed'),{status:res.status})
    return value
  }
  return {
    async *inventory() {
      let cursor=null
      do {
        const url=new URL('/api/v1/references',base)
        url.search=new URLSearchParams({application,...cursor}).toString()
        const page=await request(url,'GET')
        yield* page.entries
        cursor=page.next
      }while(cursor)
    },
    read:(resource,slot='cover')=>request(endpoint(resource,slot),'GET'),
    publish:({resource,slot='cover',assetId,revisionId,expectedGeneration,reason})=>
      request(endpoint(resource,slot),'PUT',{assetId,revisionId,expectedGeneration,reason}),
    detach:({resource,slot='cover',expectedGeneration,reason})=>
      request(endpoint(resource,slot),'DELETE',{expectedGeneration,reason}),
    async rollback({resource,slot='cover',toGeneration,expectedGeneration,reason}) {
      const url=endpoint(resource,slot)
      const state=await request(url,'GET')
      if(state.generation!==expectedGeneration)throw Error('The live reference changed.')
      const old=state.history.find(x=>x.generation===toGeneration)
      if(!old)throw Error('Historical generation unavailable.')
      return request(url,old.assetId?'PUT':'DELETE',{assetId:old.assetId,revisionId:old.revisionId,expectedGeneration,reason})
    }
  }
}
