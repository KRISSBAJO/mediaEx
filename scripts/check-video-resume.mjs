import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const origin = new URL(process.env.MEDIAEX_URL).origin
assert.ok(origin.startsWith('https://'))
const key = process.env.MEDIAEX_MONITOR_KEY
const workspace = process.env.MEDIAEX_MONITOR_WORKSPACE
assert.ok(key && workspace)
let stage = 'workspace'
let assetId
let dir

async function api(path, method = 'GET', body) {
  const res = await fetch(origin + '/api/v1/' + path, {
    method, headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: body && JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45000),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return method === 'DELETE' ? null : res.json()
}

async function uploadPart(number, data) {
  const { parts } = await api('uploads/' + assetId + '/parts', 'POST', { numbers: [number] })
  const part = parts[0]
  assert.equal(part.number, number)
  assert.equal(part.size, data.length)
  const url = new URL(part.url)
  assert.equal(url.protocol, 'https:')
  const headers = new Headers(part.headers)
  if (url.origin === origin && url.pathname === '/api/v1/uploads/' + assetId + '/parts/' + number) {
    headers.set('authorization', 'Bearer ' + key)
  }
  const res = await fetch(url, { method: 'PUT', headers, body: data, redirect: 'error', signal: AbortSignal.timeout(90000) })
  if (!res.ok) throw new Error('Part ' + number + ' HTTP ' + res.status)
}

try {
  const identity = await api('whoami')
  assert.equal(identity.workspace.id, workspace)
  assert.equal(identity.key.scope, 'full')
  stage = 'generate'
  dir = await mkdtemp(join(tmpdir(), 'mediaex-video-'))
  const path = join(dir, 'fixture.mp4')
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-t','3','-c:v','libx264','-pix_fmt','yuv420p',path])
  // A valid, ignorable MP4 free-space box makes even the bucket path require two parts.
  const free = Buffer.alloc(18 * 1024 * 1024)
  free.writeUInt32BE(free.length)
  free.write('free', 4)
  const video = Buffer.concat([await readFile(path), free])
  stage = 'create'
  const { asset, upload } = await api('uploads', 'POST', { fileName: 'resume-check.mp4', mimeType: 'video/mp4', size: video.length, multipart: true })
  assert.match(asset.id, /^ast_[a-z0-9]{6,20}$/)
  assetId = asset.id
  assert.equal(upload.kind, 'multipart')
  assert.ok(upload.partCount >= 2)
  stage = 'transfer-first-part'
  await uploadPart(1, video.subarray(0, upload.partSize))
  stage = 'resume'
  const resumed = await api('uploads/' + assetId + '/parts')
  assert.deepEqual(resumed.uploaded, [{ number: 1, size: upload.partSize }])
  for (let n = 2; n <= resumed.partCount; n++) {
    await uploadPart(n, video.subarray((n - 1) * resumed.partSize, n * resumed.partSize))
  }
  stage = 'complete'
  const completed = await Promise.all([1, 2].map(() => api('uploads/' + assetId + '/complete', 'POST')))
  for (const response of completed) assert.equal(response.asset.id, assetId)
  stage = 'encode'
  const deadline = Date.now() + 360000
  while (true) {
    const { asset: result } = await api('assets/' + assetId)
    if (result.status === 'ready') break
    if (result.status === 'failed' || Date.now() > deadline) throw new Error('Video did not reach ready')
    await delay(3000)
  }
  stage = 'playback'
  const grant = await api('assets/' + assetId + '/playback-token', 'POST', { expiresIn: 300 })
  let url = new URL(grant.playbackUrl, origin)
  for (let depth = 0; depth < 3; depth++) {
    assert.equal(url.protocol, 'https:')
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) })
    if (!res.ok) throw new Error('Playback HTTP ' + res.status)
    const data = Buffer.from(await res.arrayBuffer())
    const playlist = data.toString('utf8')
    if (!playlist.startsWith('#EXTM3U')) {
      assert.ok(depth > 0 && data.length > 188 && !res.headers.get('content-type')?.includes('text'))
      break
    }
    const entry = playlist.split(/\r?\n/).find(line => line.trim() && !line.startsWith('#'))
    assert.ok(entry && depth < 2)
    url = new URL(entry, res.url)
  }
  console.log(JSON.stringify({ assetId, bytes: video.length, parts: resumed.partCount, result: 'passed' }))
} catch (error) {
  console.error(JSON.stringify({ assetId, stage, reason: error.code || (error.message.startsWith('HTTP ') ? error.message : 'check failed') }))
  process.exitCode = 1
} finally {
  if (dir) await rm(dir, { recursive: true, force: true })
  if (assetId) {
    try { await api('assets/' + assetId, 'DELETE') }
    catch { console.error(JSON.stringify({ assetId, stage: 'cleanup', result: 'failed' })); process.exitCode = 1 }
  }
}

