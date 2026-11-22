import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { AwsClient } from 'aws4fetch'
import { S3Storage } from './media/storage.mts'
import { StorageVault, storageKey, type StorageKey } from './media/storage-vault.mts'

const exec = promisify(execFile)
async function ffmpeg(args: string[]) {
  try {
    await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { timeout: 30000 })
  } catch { throw new Error('FFmpeg could not complete the storage proof.') }
}

export async function proveMedia(vault: StorageVault, key: StorageKey) {
  const { endpoint, region, bucket, workspace } = vault.scope
  const signer = new AwsClient({ ...key, region, service: 's3', retries: 0 })
  const store = new S3Storage(endpoint, bucket, async () => signer, { redirect: 'error', signal: AbortSignal.timeout(90000) })
  const dir = await mkdtemp(path.join(tmpdir(), 'mediaex-vault-'))
  const id = randomUUID()
  const prefix = workspace + '/' + id
  const original = prefix + '/original.mp4'
  const files = [original, prefix + '/hls/test.m3u8', prefix + '/hls/part0.ts']
  let sent = false
  try {
    const source = path.join(dir, 'fixture.mp4')
    await ffmpeg(['-f','lavfi','-i','color=c=blue:s=128x96:r=10','-t','1','-c:v','libx264','-pix_fmt','yuv420p',source])
    const bytes = await readFile(source)
    const target = await store.uploadTarget(original, id, bytes.length)
    sent = true
    const uploaded = await fetch(target.url, { method: target.method, headers: target.headers, body: bytes, redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!uploaded.ok) {
      if ([401, 403].includes(uploaded.status)) sent = false
      throw new Error('Candidate upload failed (HTTP ' + uploaded.status + ').')
    }
    const copy = await store.localCopy(original, dir)
    if (!(await readFile(copy)).equals(bytes)) throw new Error('Uploaded media checksum mismatch.')
    const output = await store.outputDir(prefix + '/hls', dir)
    const segment = path.join(output.dir, 'part0.ts')
    await ffmpeg(['-i',copy,'-map','0:v','-c:v','libx264','-threads','1','-hls_time','2','-hls_playlist_type','vod','-hls_segment_filename',path.join(output.dir,'part%d.ts'),path.join(output.dir,'test.m3u8')])
    const generated = (await readdir(output.dir)).sort()
    if (generated.join(',') !== 'part0.ts,test.m3u8') throw new Error('FFmpeg produced an incomplete test playlist.')
    await output.publish()
    const playlist = await store.serve(files[1], new Request('https://mediaex.invalid/proof'), { access: { expiresAt: Math.floor(Date.now()/1000) + 60 } })
    if (!playlist.ok) throw new Error('Candidate playback playlist failed.')
    const lines = (await playlist.text()).trim().split(/\r?\n/)
    const clips = lines.filter(l => l && !l.startsWith('#'))
    if (lines[0] !== '#EXTM3U' || clips.length !== 1) throw new Error('Unexpected playback playlist.')
    const signed = new URL(clips[0])
    if (signed.origin !== endpoint || signed.pathname !== '/' + bucket + '/' + files[2]) throw new Error('Unexpected playback destination.')
    const played = await fetch(signed, { redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!played.ok) throw new Error('Candidate playback segment failed.')
    const delivery = Buffer.from(await played.arrayBuffer())
    if (!delivery.equals(await readFile(segment))) throw new Error('Playback segment checksum mismatch.')
    const downloaded = path.join(dir,'playback.ts')
    await writeFile(downloaded, delivery)
    await ffmpeg(['-xerror','-i',downloaded,'-frames:v','1','-f','null','-'])
  } finally {
    try {
      if (sent) {
        const cleaned = await Promise.allSettled(files.map(k => store.remove(k)))
        if (cleaned.some(r => r.status === 'rejected')) throw new Error('Candidate access or proof cleanup failed. Inspect fixture prefix ' + prefix + '.')
      }
    } finally { await rm(dir, { recursive: true, force: true }) }
  }
}

export async function rotate(vault: StorageVault, expected: number, key: StorageKey, prove = proveMedia) {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('A nonnegative expected version is required.')
  const old = await vault.current()
  if ((old?.version ?? 0) !== expected) throw new Error('The active version changed. Read status before retrying.')
  if (old?.record.key.accessKeyId === key.accessKeyId) throw new Error('Supply a distinct replacement key.')
  const actor = await vault.actor()
  await prove(vault, key)
  const now = Date.now()
  const proof = { actor, checkedAt: new Date(now).toISOString(), previousVersion: expected,
    earliestRetirement: expected ? new Date(now + (24 * 60 + 5) * 60000).toISOString() : null }
  const version = await vault.activate(expected, key, proof)
  return { version, ...proof }
}

async function main() {
  const [cmd, expected, ...extra] = process.argv.slice(2)
  const vault = new StorageVault('operator')
  if (cmd === 'status' && expected === undefined) {
    const active = await vault.current()
    console.log(JSON.stringify(active ? { version: active.version, ...active.record.proof } : { version: 0 }))
    return
  }
  if (cmd !== 'rotate' || !expected || !/^(0|[1-9][0-9]*)$/.test(expected) || extra.length || process.stdin.isTTY) {
    throw new Error('Use status, or pipe a credential JSON object to rotate EXPECTED_VERSION.')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > 16384) throw new Error('Credential input too large.')
    chunks.push(chunk)
  }
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('Invalid credential JSON.') }
  console.log(JSON.stringify(await rotate(vault, Number(expected), storageKey(value))))
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    // Only messages generated here have been reviewed for operator output.
    const text = error instanceof Error ? error.message : ''
    const safe = /^(Candidate (?:upload failed \(HTTP \d+\)\.|access or proof cleanup failed\. Inspect fixture prefix [A-Za-z0-9_/-]+\.)|The active version changed\. Read status before retrying\.|OpenBao refused activation \(HTTP \d+\)\. Read status before retrying\.|Supply a distinct replacement key\.)$/
    console.error(safe.test(text) ? text : 'Storage proof or vault operation failed. Check operator configuration and active version.')
    process.exitCode = 1
  })
}
