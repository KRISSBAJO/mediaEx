// Internal to check-offline-restore. Refuse to use an ambient database or media directory.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [phase, root] = process.argv.slice(2)
assert.ok(['source', 'replacement'].includes(phase) && path.isAbsolute(root))
// Construct the connection from this drill's paths, independently of any operator settings.
const live = process.argv[4] === '--live-db'
if (live) {
  const db = path.join(root, phase, 'db')
  const password = await readFile(path.join(root, 'password'), 'utf8')
  assert.match(password, /^[0-9a-f]{64}$/)
  process.env.DATABASE_URL = 'postgresql://drill:' + password + '@localhost/postgres?host=' + encodeURIComponent(db)
}
process.env.MEDIA_DIR = path.join(root, phase, 'media')
const { pool, auth } = await import('../backend/auth.mts')
const { handleMedia } = await import('../backend/media/routes.mts')
const { playbackLinks } = await import('../backend/media/playback.mts')
const { getAssetRow } = await import('../backend/media/assets.mts')

if (live) {
  const result = await pool.query("select current_setting('data_directory') as dir, inet_server_addr() as addr")
  assert.equal(result.rows[0].dir, path.join(root, phase, 'db'))
  assert.equal(result.rows[0].addr, null)
} else {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const fixture = JSON.parse(input)
  assert.equal(fixture.assets.length, 2)
  assert.match(fixture.secret, /^[0-9a-f]{64}$/)
  auth.api.getSession = async () => null // all viewers in this fixture are anonymous
  pool.connect = () => { throw new Error('Offline fixture cannot open database connections') }
  pool.query = async (sql, params) => {
    if (sql.includes('from "asset" a left join "user"')) {
      return { rows: fixture.assets.filter(row => row.id === params[0] && !row.deletedAt) }
    }
    if (sql.includes('returning "playbackSecret"') && params[0] === 'pilot') {
      return { rows: [{ playbackSecret: fixture.secret }] }
    }
    throw new Error('Unexpected database operation in offline route fixture')
  }
}

const links = path.join(root, 'viewer-links.json')
const base = 'http://localhost:3400'
const request = url => handleMedia(new Request(new URL(url, base)), new URL(url, base).pathname)
try {
  if (phase === 'source') {
    const row = await getAssetRow('ast_video01')
    const grant = await playbackLinks(row, 3600, false)
    const cover = await request('/api/media/ast_cover01/info')
    assert.equal(cover.status, 200)
    const { thumbUrl } = await cover.json()
    await writeFile(links, JSON.stringify({ thumbUrl, playlist: grant.playbackUrl }), { mode: 0o600 })
  }

  const { thumbUrl, playlist } = JSON.parse(await readFile(links, 'utf8'))
  assert.equal(thumbUrl, '/api/media/ast_cover01/thumb.jpg')
  assert.equal(new URL(playlist, base).pathname, '/api/media/ast_video01/hls/index.m3u8')
  const thumbnail = await request(thumbUrl)
  assert.equal(thumbnail.status, 200)
  assert.deepEqual(Buffer.from(await thumbnail.arrayBuffer()), await readFile(path.join(process.env.MEDIA_DIR, 'pilot/cover/thumb.jpg')))
  assert.equal((await request(new URL(playlist, base).pathname)).status, 404)
  assert.equal((await request('/api/media/ast_cover01/original')).status, 404)
  const manifest = await request(playlist)
  assert.equal(manifest.status, 200)
  const entries = (await manifest.text()).split(/\r?\n/).filter(line => line && !line.startsWith('#'))
  assert.ok(entries.length >= 2)
  for (const entry of entries) {
    const segment = new URL(entry, new URL(playlist, base))
    assert.equal((await request(segment.pathname)).status, 404)
    const response = await request(segment)
    assert.equal(response.status, 200)
    const file = path.join(process.env.MEDIA_DIR, 'pilot/video/hls', path.basename(segment.pathname))
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(file))
  }
} finally {
  await pool.end()
}
