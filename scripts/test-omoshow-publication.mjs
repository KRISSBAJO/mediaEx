import assert from 'node:assert/strict'
import test from 'node:test'
import {publicationClient} from '../examples/omoshow-publication.mjs'

test('Omoshow publishes and reverses one event while a second event keeps its cover',async()=>{
  const refs=new Map()
  const fetchImpl=async(url,options)=>{
    assert.equal(url.origin,'https://media.example.test')
    assert.equal(options.headers.authorization,'Bearer fixture')
    const name=url.searchParams.get('resource'), prior=refs.get(name)??{generation:0,assetId:null,revisionId:null,history:[]}
    if(options.method==='GET')return Response.json(prior)
    const edit=JSON.parse(options.body)
    if(edit.expectedGeneration!==prior.generation)return Response.json({error:'changed'},{status:409})
    const current={assetId:edit.assetId??null,revisionId:edit.revisionId??null,generation:prior.generation+1}
    const state={...current,history:[current,...prior.history]}
    refs.set(name,state);return Response.json(current)
  }
  const client=publicationClient({origin:'https://media.example.test',key:'fixture',application:'omoshow',fetchImpl})
  const base={assetId:'first',revisionId:'v1',expectedGeneration:0,reason:'Initial cover'}
  await client.publish({...base,resource:'event:a'})
  await client.publish({...base,resource:'event:b'})
  await client.publish({...base,resource:'event:a',assetId:'second',revisionId:'v2',expectedGeneration:1})
  await assert.rejects(client.publish({...base,resource:'event:a',expectedGeneration:1}),e=>e.status===409)
  await client.rollback({resource:'event:a',toGeneration:1,expectedGeneration:2,reason:'Restore original'})
  assert.equal((await client.read('event:a')).revisionId,'v1')
  assert.equal((await client.read('event:b')).generation,1)
})
