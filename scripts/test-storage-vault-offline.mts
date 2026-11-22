// Same media/rotation assertions as the Docker exercise. Only the two HTTP services are simulated.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const scratch = await mkdtemp(path.join(tmpdir(), 'mediaex-offline-'))
const keys = [0, 1].map(() => ({ accessKeyId: randomBytes(12).toString('hex'), secretAccessKey: randomBytes(32).toString('hex') }))
const operator = randomBytes(16).toString('hex')
const reader = randomBytes(16).toString('hex')
const bucket = 'pilot-media'
const workspace = 'studio-a'
const data = new Map<string, Uint8Array<ArrayBuffer>>()
let version = 0
let record: object | undefined
let vaultUp = true
const json = (body: object, status = 200) => Response.json(body, { status })
const changed = Object.entries({
  MEDIAEX_VAULT_ADDR: 'https://vault.invalid', MEDIAEX_VAULT_WORKSPACE: workspace, MEDIAEX_S3_WORKSPACE_IDS: workspace,
  MEDIAEX_VAULT_OPERATOR_TOKEN_FILE: path.join(scratch,'operator'), MEDIAEX_VAULT_TOKEN_FILE: path.join(scratch,'reader'),
  S3_ENDPOINT: 'https://s3.invalid', S3_REGION: 'us-east-1', S3_BUCKET: bucket,
})
const originalFetch = globalThis.fetch
const before = { ...process.env }
try {
  for (const [k,v] of changed) process.env[k] = v
  for (const k of ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_SESSION_TOKEN']) delete process.env[k]
  await writeFile(process.env.MEDIAEX_VAULT_OPERATOR_TOKEN_FILE!, operator, { mode: 0o600 })
  await writeFile(process.env.MEDIAEX_VAULT_TOKEN_FILE!, reader, { mode: 0o600 })
  const keyFile = path.join(scratch,'keys.json')
  await writeFile(keyFile, JSON.stringify(keys), { mode: 0o600 })
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (url.origin === 'https://vault.invalid') {
      if (!vaultUp) return json({}, 503)
      const identity = req.headers.get('X-Vault-Token')
      if (identity !== operator && identity !== reader) return json({},403)
      if (url.pathname === '/v1/auth/token/lookup-self') return json({data:{display_name:'token-pilot-operator'}})
      if (url.pathname !== '/v1/mediaex/data/workspaces/studio-a/storage') return json({},403)
      if (req.method === 'GET') return record ? json({ data: { metadata: { version }, data: record } }) : json({},404)
      const value = await req.json()
      if (identity !== operator) return json({},403)
      if (value.options.cas !== version) return json({},400)
      record = value.data
      return json({data:{version:++version}})
    }
    if (url.origin !== 'https://s3.invalid') throw new Error('Unexpected test host.')
    const credential = url.searchParams.get('X-Amz-Credential')?.split('/')[0] || req.headers.get('Authorization')?.match(/Credential=([^/]+)/)?.[1]
    if (!keys.some(k => k.accessKeyId === credential) || !url.pathname.startsWith('/' + bucket + '/' + workspace + '/')) return json({},403)
    if (req.method === 'PUT') {
      data.set(url.pathname,new Uint8Array(await req.arrayBuffer()))
      return new Response(null,{status:200})
    }
    if (req.method === 'DELETE') {
      data.delete(url.pathname)
      return new Response(null,{status:204})
    }
    const object = data.get(url.pathname)
    return object ? new Response(object) : new Response(null,{status:404})
  }
  process.argv[2] = keyFile
  await import('./test-storage-vault.mts')
  const { storageForWorkspace } = await import('../backend/media/storage.mts')
  const { vaultStatus } = await import('../backend/media/storage-vault.mts')
  vaultUp = false
  await assert.rejects(storageForWorkspace(workspace).readableUrl('studio-a/test/file.mp4'))
  assert.deepEqual(await vaultStatus(workspace, 'owner'), {state:'unavailable'})
  assert.equal(data.size, 0, 'Proof must clean up scratch objects.')
  console.log('Passed vault outage and fixture cleanup. FFmpeg ran locally with simulated OpenBao and S3 responses.')
} finally {
  globalThis.fetch = originalFetch
  for (const k of [...changed.map(([k]) => k), 'S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_SESSION_TOKEN']) {
    if (before[k] === undefined) delete process.env[k]
    else process.env[k] = before[k]
  }
  await rm(scratch, {recursive:true,force:true})
}
