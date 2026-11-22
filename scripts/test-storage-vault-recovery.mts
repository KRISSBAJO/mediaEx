// Integration drill for the disposable PostgreSQL, MinIO and OpenBao fixtures.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const fixtureDir = process.argv[2]
const db = new URL(process.env.DATABASE_URL ?? '')
const origin = 'https://mediaex.example.test'
const org = 'studio-a'
assert.ok(process.env.CI === 'true' && db.hostname === '127.0.0.1' && db.pathname === '/mediaex_vault_fixture')
assert.equal(process.env.BETTER_AUTH_URL, origin)
assert.equal(process.env.MEDIAEX_VAULT_WORKSPACE, org)
for (const endpoint of [process.env.S3_ENDPOINT, process.env.MEDIAEX_VAULT_ADDR]) {
  assert.equal(new URL(endpoint!).hostname, '127.0.0.1')
}
assert.equal(process.env.BACKUP_DIR, path.join(fixtureDir, 'backup'))
const { auth, pool } = await import('../backend/auth.mts')
const { handleMedia } = await import('../backend/media/routes.mts')
const { storageForWorkspace, backupStore } = await import('../backend/media/storage.mts')
const { runBackups } = await import('../backend/media/backup.mts')
const { StorageVault } = await import('../backend/media/storage-vault.mts')
const { rotate } = await import('../backend/rotate-storage.mts')
const keys = JSON.parse(await readFile(path.join(fixtureDir, 'keys.json'), 'utf8'))
const vault = new StorageVault('operator')
const primary = storageForWorkspace(org)
const secondary = backupStore()
assert.ok(primary.kind === 's3' && secondary?.kind === 'local')
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

let stage = 'disposable studio setup'
let cookie = ''
function request(method: string, route: string, data?: object, signedIn = true) {
  return new Request(new URL(route, origin), {
    method, headers: { origin, 'content-type': 'application/json', ...(signedIn ? { cookie } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
}
async function call(method: string, route: string, data?: object, signedIn = true) {
  const response = await handleMedia(request(method, route, data, signedIn), new URL(route, origin).pathname)
  assert.ok(response?.ok, 'MediaEX returned ' + (response?.status ?? 'no response') + ' during ' + stage)
  return response
}
async function session(route: string, data: object) {
  const res = await auth.handler(request('POST', '/api/auth/' + route, data))
  assert.ok(res.ok, 'Auth returned ' + res.status + ' during ' + stage)
  const set = res.headers.getSetCookie().map(v => v.split(';')[0])
  if (set.length) {
    const jar = new Map<string, string>()
    for (const item of [...cookie.split('; ').filter(Boolean), ...set]) jar.set(item.split('=')[0], item)
    cookie = Array.from(jar.values()).join('; ')
  }
  return res.json()
}
async function segmentFor(playlist: string) {
  let url = new URL(playlist, origin)
  for (let i = 0; i < 3; i++) {
    const res = await call('GET', url.pathname, undefined, false)
    const body = await res.text()
    assert.ok(body.startsWith('#EXTM3U'))
    const first = body.split(/\r?\n/).find(line => line.trim() && !line.startsWith('#'))
    assert.ok(first)
    url = new URL(first.trim(), url)
    if (url.origin !== origin) {
      assert.equal(url.origin, new URL(process.env.S3_ENDPOINT!).origin)
      return url
    }
  }
  throw new Error('No playable HLS segment was issued')
}
async function segmentBytes(url: URL) {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) })
  assert.ok(res.ok)
  const bytes = Buffer.from(await res.arrayBuffer())
  assert.ok(bytes.length > 256)
  return bytes
}
try {
  const account = await session('sign-up/email', {
    name: 'Recovery fixture', email: randomUUID() + '@example.test', password: randomBytes(24).toString('hex'),
  })
  await pool.query('insert into organization (id,name,slug,"createdAt") values ($1,$2,$3,now())', [org, 'CI recovery studio', 'ci-recovery-studio'])
  await pool.query('insert into member (id,"userId","organizationId",role,"createdAt") values ($1,$2,$3,$4,now())', [randomUUID(), account.user.id, org, 'owner'])
  await pool.query('insert into workspace_admin ("organizationId","planOverride") values ($1,$2)', [org, 'pro'])
  await session('organization/set-active', { organizationId: org })
  const settings = await (await call('PUT', '/api/assets/backup', { enabled: true })).json()
  assert.ok(settings.enabled && settings.available && settings.planIncludes)

  stage = 'video generation'
  const mp4 = path.join(fixtureDir, 'original.mp4')
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','2','-c:v','libx264','-pix_fmt','yuv420p',mp4])
  // A legal ISO BMFF free-space box crosses MediaEX's 16 MiB part boundary without a long encode.
  const free = Buffer.alloc(17 * 1024 * 1024)
  free.writeUInt32BE(free.length)
  free.write('free', 4, 'ascii')
  const original = Buffer.concat([await readFile(mp4), free])
  const originalHash = digest(original)
  stage = 'multipart upload through the studio API'
  const reservation = await (await call('POST', '/api/uploads', { fileName: 'recovery.mp4', size: original.length, mimeType: 'video/mp4', multipart: true })).json()
  const { asset, upload } = reservation
  assert.equal(upload.partCount, 2)
  const { parts } = await (await call('POST', upload.parts, { numbers: [1,2] })).json()
  async function send(index: number) {
    const target = parts[index]
    const range = original.subarray(index * upload.partSize, (index + 1) * upload.partSize)
    assert.equal(range.length, target.size)
    const url = new URL(target.url)
    assert.equal(url.origin, new URL(process.env.S3_ENDPOINT!).origin)
    assert.ok(url.searchParams.get('X-Amz-Credential')?.startsWith(keys[1].accessKeyId + '/'))
    const res = await fetch(url, { method: 'PUT', headers: target.headers, body: range, redirect: 'error', signal: AbortSignal.timeout(30000) })
    assert.equal(res.status, 200)
    await res.body?.cancel()
  }
  await send(0)
  stage = 'credential rotation during multipart upload'
  assert.equal((await rotate(vault, 2, keys[0])).version, 3)
  await send(1)
  await call('POST', '/api/uploads/' + asset.id + '/complete', {})
  const key = org + '/' + asset.id + '/original.mp4'
  assert.equal(digest(await primary.getBuffer(key)), originalHash)
  console.log('Passed real two-part video upload across credential rotation (' + original.length + ' bytes).')

  stage = 'encoder and public playback'
  let ready
  for (let i = 0; i < 90; i++) {
    const result = await (await call('GET', '/api/assets/' + asset.id)).json()
    assert.notEqual(result.asset.status, 'failed', 'The fixture encoder failed')
    if (result.asset.status === 'ready') { ready = result.asset; break }
    await delay(1000)
  }
  assert.ok(ready?.playbackUrl)
  const oldSegment = await segmentFor(ready.playbackUrl)
  const segmentHash = digest(await segmentBytes(oldSegment))
  assert.equal((await rotate(vault, 3, keys[1])).version, 4)
  assert.equal(digest(await segmentBytes(oldSegment)), segmentHash)
  assert.equal(digest(await segmentBytes(await segmentFor(ready.playbackUrl))), segmentHash)
  console.log('Passed playback from the same playlist and its previously issued segment URL after a second storage credential rotation.')

  stage = 'backup copier'
  await runBackups()
  const backupRoute = '/api/assets/' + asset.id + '/backup'
  const copy = await (await call('GET', backupRoute)).json()
  assert.equal(copy.status, 'copied')
  assert.equal(copy.bytes, original.length)
  assert.equal(digest(await secondary.getBuffer(key)), originalHash)
  stage = 'restore of the disposable fixture original'
  await primary.remove(key)
  assert.equal(await primary.size(key), null)
  const result = await (await call('POST', backupRoute + '/restore', {})).json()
  assert.ok(result.restored)
  const restored = Buffer.from(await (await call('GET', '/api/media/' + asset.id + '/original')).arrayBuffer())
  assert.equal(digest(restored), originalHash)
  const recovered = path.join(fixtureDir, 'recovered.mp4')
  await writeFile(recovered, restored)
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-xerror','-i',recovered,'-f','null','-'])
  const audit = await pool.query('select action from asset_recovery_event where "assetId"=$1 and actor=$2', [asset.id, 'user:' + account.user.id])
  assert.ok(audit.rows.some(row => row.action === 'original restored from backup'))
  console.log('Passed MediaEX backup, original loss, authenticated restore, owner audit, FFmpeg decode and SHA-256 ' + originalHash + '.')
} catch (error) {
  // Some provider errors contain signed URLs. Limit diagnostics to the phase, type and source line.
  const frame = String((error as Error).stack).split('\n').find(line => /at .*test-storage-vault-recovery\.mts:\d+/.test(line))
  const location = frame?.match(/test-storage-vault-recovery\.mts:\d+:\d+/)?.[0] ?? 'dependency'
  console.error('Recovery drill failed during ' + stage + ' (' + (error as Error).name + ', ' + location + ').')
  process.exitCode = 1
} finally {
  await pool.end()
}
