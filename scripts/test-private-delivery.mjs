import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { storage } from '../backend/media/storage.mts'
import { pool } from '../backend/auth.mts'
import { playbackLinks, tokenisePlaylist, verifiedPlaybackExpiry } from '../backend/media/playback.mts'

const now = new Date('2026-10-10T10:00:00.500Z')
const second = Math.floor(now.getTime() / 1000)
const request = new Request('https://media.example.test/api/media/ast_test/hls/master.m3u8')
const playlist = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nseg_001.m4s\nvideo/index.m3u8'
const noStore = 'private, no-store'

test('links for a stored revision keep the logical asset URL and expire at the granted second', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now })
  t.mock.method(pool, 'query', async () => ({ rows: [{ playbackSecret: 'fixture-signing-secret' }] }))
  const row = { id: 'ast_logical', organizationId: 'qa', originalKey: 'qa/ast_longer_revision/original.mp4',
    playlistKey: 'qa/ast_longer_revision/hls/master.m3u8' }
  const links = await playbackLinks(row, 60, false)
  const url = new URL(links.playbackUrl, request.url)
  assert.equal(url.pathname, '/api/media/ast_logical/hls/master.m3u8')
  assert.equal(url.searchParams.get('token'), links.token)
  assert.equal(await verifiedPlaybackExpiry(row, links.token), second + 60)
  assert.equal(await verifiedPlaybackExpiry({ ...row, id: 'ast_other' }, links.token), null)
  t.mock.timers.tick(59_500)
  assert.equal(await verifiedPlaybackExpiry(row, links.token), null)
})

function checkSignature(url, seconds) {
  const signed = new URL(url)
  assert.equal(signed.searchParams.get('X-Amz-Date'), '20261010T100000Z')
  assert.equal(signed.searchParams.get('X-Amz-Expires'), String(seconds))
  assert.ok(signed.searchParams.has('X-Amz-Signature'))
  return signed.searchParams
}

test('signed delivery carries its expiry into bucket objects, manifests and range reads', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now })
  Object.assign(process.env, {
    S3_BUCKET: 'fixture-bucket', S3_ENDPOINT: 'https://bucket.example.test', S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'fixture-id', S3_SECRET_ACCESS_KEY: 'fixture-only-secret', S3_SESSION_TOKEN: '',
  })
  const bucket = storage({ storageBackend: 's3' })
  let delay = 0
  t.mock.method(globalThis, 'fetch', async (req) => {
    assert.equal(new URL(req.url).hostname, 'bucket.example.test')
    if (req.url.endsWith('.m3u8')) {
      if (delay) t.mock.timers.tick(delay)
      return new Response(playlist)
    }
    assert.equal(req.headers.get('range'), 'bytes=0-2')
    return new Response('abc', { status: 206, headers: { 'content-range': 'bytes 0-2/10' } })
  })
  const grant = { expiresAt: second + 5 }
  const res = await bucket.serve('workspace/asset/hls/main.m3u8', request, { access: grant })
  assert.equal(res.headers.get('cache-control'), noStore)
  const lines = tokenisePlaylist(await res.text(), 'fixture-token').split('\n')
  assert.equal(checkSignature(lines[1].match(/URI="([^"]+)"/)[1], 5).get('response-cache-control'), noStore)
  assert.equal(checkSignature(lines[2], 5).get('response-cache-control'), noStore)
  assert.equal(lines[3], 'video/index.m3u8?token=fixture-token')

  for (const file of ['thumb.jpg', 'captions/en.vtt', 'derived/variant.webp']) {
    const redirect = await bucket.serve('workspace/asset/' + file, request, { access: grant })
    assert.equal(redirect.status, 302)
    assert.equal(redirect.headers.get('cache-control'), noStore)
    assert.equal(checkSignature(redirect.headers.get('location'), 5).get('response-cache-control'), noStore)
  }
  const long = await bucket.serve('workspace/asset/poster.jpg', request, { access: { expiresAt: second + 86400 } })
  checkSignature(long.headers.get('location'), 3600)
  const open = await bucket.serve('workspace/asset/poster.jpg', request, { access: 'public' })
  assert.equal(checkSignature(open.headers.get('location'), 3600).has('response-cache-control'), false)

  const member = await bucket.serve('workspace/asset/original.mp4', new Request(request, { headers: { range: 'bytes=0-2' } }), {
    access: 'member', download: 'video.mp4',
  })
  assert.equal(member.status, 206)
  assert.equal(member.headers.get('location'), null)
  assert.equal(member.headers.get('content-range'), 'bytes 0-2/10')
  assert.equal(member.headers.get('cache-control'), noStore)
  assert.equal(await member.text(), 'abc')
  // A manifest read can start during the grant and finish after it.
  delay = 5000
  const expired = await bucket.serve('workspace/asset/hls/main.m3u8', request, { access: grant })
  assert.equal(expired.status, 404)
  assert.equal(expired.headers.get('cache-control'), noStore)
  assert.equal(expired.headers.get('location'), null)
})

test('private disk reads and HEAD range responses respect the original grant', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now })
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'mediaex-delivery-'))
  process.env.MEDIA_DIR = fixture
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const disk = storage({ storageBackend: 'local' })
  const key = 'workspace/asset/captions/en.vtt'
  await mkdir(path.join(fixture, path.dirname(key)), { recursive: true })
  await writeFile(path.join(fixture, key), 'WEBVTT')
  const access = { expiresAt: second + 1 }
  const content = await disk.serve(key, request, { access })
  assert.equal(content.headers.get('cache-control'), noStore)
  assert.equal(await content.text(), 'WEBVTT')
  const head = await disk.serve(key, new Request(request, { method: 'HEAD', headers: { range: 'bytes=1-3' } }), { access })
  assert.equal(head.status, 206)
  assert.equal(head.headers.get('content-range'), 'bytes 1-3/6')
  assert.equal(head.body, null)
  t.mock.timers.tick(500)
  assert.equal((await disk.serve(key, request, { access })).status, 404)
})
