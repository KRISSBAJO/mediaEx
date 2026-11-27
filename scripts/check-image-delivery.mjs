import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'

// Run against a dedicated monitor workspace. DELETE moves the created asset to trash.
const origin = new URL(process.env.MEDIAEX_URL).origin
const token = process.env.MEDIAEX_MONITOR_KEY
const workspace = process.env.MEDIAEX_MONITOR_WORKSPACE
if (!token || !workspace) throw new Error('Set MEDIAEX_MONITOR_KEY and MEDIAEX_MONITOR_WORKSPACE')
if (!origin.startsWith('https://') && !origin.startsWith('http://127.0.0.1:')) {
  throw new Error('Use HTTPS for remote checks')
}
const profile = process.env.MEDIAEX_IMAGE_PROFILE ?? 'phone'
if (!['small', 'phone'].includes(profile)) throw new Error('Unknown image profile')
const [width, height] = profile === 'small' ? [160, 120] : [1600, 1200]
const runId = randomUUID()
let stage = 'workspace'
let assetId

async function request(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(45000), redirect: 'error' })
  if (!response.ok) {
    const id = response.headers.get('x-mediaex-request-id')
    const suffix = id && /^[0-9a-f-]{36}$/i.test(id) ? ' (MediaEX request ' + id + ')' : ''
    throw new Error('HTTP ' + response.status + suffix)
  }
  return response
}

function api(path, method = 'GET', payload) {
  return request(origin + '/api/v1/' + path, {
    method,
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
}

async function run() {
  const identity = await (await api('whoami')).json()
  if (identity.workspace.id !== workspace || identity.key.scope !== 'full') {
    throw new Error('Expected a full key in the designated monitor workspace')
  }
  stage = 'create'
  const photo = await sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  }).jpeg({ quality: 94 }).toBuffer()
  const { asset, upload } = await (await api('uploads', 'POST', {
    fileName: 'venue-monitor-' + runId + '.jpg', mimeType: 'image/jpeg', size: photo.length,
  })).json()
  if (!/^ast_[a-z0-9]{6,20}$/.test(asset.id)) throw new Error('Unexpected asset ID')
  assetId = asset.id
  stage = 'transfer'
  if (upload.kind !== 'single') throw new Error('Expected a single image upload')
  const target = new URL(upload.url, origin)
  const headers = new Headers(upload.headers)
  if (target.origin === origin && target.pathname === '/api/v1/uploads/' + assetId) {
    headers.set('authorization', 'Bearer ' + token)
  } else if (target.protocol !== 'https:') throw new Error('Expected HTTPS storage target')
  await request(target, { method: 'PUT', headers, body: photo })
  stage = 'complete'
  await api('uploads/' + assetId + '/complete', 'POST')
  stage = 'processing'
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    const { asset: result } = await (await api('assets/' + assetId)).json()
    if (result.status === 'failed') throw new Error('Worker reported failure')
    if (result.status === 'ready') {
      stage = 'thumbnail'
      if (!result.thumbUrl) throw new Error('Missing thumbnail')
      const url = new URL(result.thumbUrl, origin)
      if (url.protocol !== 'https:' && url.origin !== origin) throw new Error('Unexpected thumbnail protocol')
      // Bucket-backed delivery may redirect to a signed URL. Send no API credential.
      const thumb = await fetch(url, { signal: AbortSignal.timeout(45000) })
      if (!thumb.ok) throw new Error('HTTP ' + thumb.status)
      await sharp(Buffer.from(await thumb.arrayBuffer())).resize(1, 1).raw().toBuffer()
      console.log(JSON.stringify({ profile, runId, assetId, stage, bytes: photo.length, result: 'passed' }))
      return
    }
    await delay(2500)
  }
  throw new Error('Processing timed out')
}

try {
  await run()
} catch (error) {
  console.error(JSON.stringify({ profile, runId, assetId, stage, error: error.message }))
  process.exitCode = 1
} finally {
  if (assetId) {
    try { await api('assets/' + assetId, 'DELETE') }
    catch (error) {
      console.error(JSON.stringify({ profile, runId, assetId, stage: 'cleanup', error: error.message }))
      process.exitCode = 1
    }
  }
}
