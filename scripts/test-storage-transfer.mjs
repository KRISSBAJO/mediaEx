import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { eligible, localInventory } from '../backend/media/storage-transfer.mts'
import { migrateStorage } from '../backend/media/storage-schema.mts'

const run = promisify(execFile)
const id = 'ast_fixture'
const workspace = 'workspace'
const prefix = workspace + '/' + id
const asset = { id, organizationId: workspace, originalKey: prefix + '/original.mp4', size: '6', storageBackend: 'local', status: 'ready',
  required: [prefix + '/hls/main.m3u8', prefix + '/captions/en.vtt', prefix + '/derived/x.jpg'] }
const fixtureFiles = { 'original.mp4': 'source', 'hls/main.m3u8': '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nseg_001.m4s',
  'hls/init.mp4': 'init', 'hls/seg_001.m4s': 'segment', 'captions/en.vtt': 'WEBVTT', 'derived/x.jpg': 'image' }

async function mount(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mediaex-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [rel, content] of Object.entries(fixtureFiles)) {
    const file = path.join(root, prefix, rel)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  return root
}

test('disk inventory verifies originals and manifest children and excludes active, trashed and versioned assets', async t => {
  const root = await mount(t)
  const inventory = await localInventory(root, asset)
  assert.equal(inventory.files.length, 6)
  for (const fields of [{ status: 'processing' }, { deletedAt: new Date() }, { versioned: true }, { captionPending: true }, { originalKey: 'workspace/other/original.mp4' }])
    assert.ok(eligible({ ...asset, ...fields }, false))
  await rm(path.join(root, prefix, 'hls/seg_001.m4s'))
  await assert.rejects(localInventory(root, asset), /playlist references a missing/)
})

test('bound bucket copy and rollback commit only after verifying complete matching inventories', {
  skip: process.env.MEDIAEX_TEST_STORAGE_TRANSFER_PG !== '1' && 'set MEDIAEX_TEST_STORAGE_TRANSFER_PG=1 with a disposable local database',
}, async t => {
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname), 'fixture requires a loopback database')
  const owner = new pg.Pool({ connectionString: url.href })
  const schema = 'qa_transfer_' + randomUUID().replaceAll('-', '')
  await owner.query('create schema ' + schema)
  url.searchParams.set('options', '-csearch_path=' + schema)
  const db = new pg.Pool({ connectionString: url.href })
  t.after(async () => { await db.end(); await owner.query('drop schema ' + schema + ' cascade'); await owner.end() })
  const root = await mount(t)
  const objects = new Map()
  const puts = []
  let damageNextRead = false
  const bucket = createServer(async (req, res) => {
    const target = new URL(req.url, 'http://localhost')
    if (target.searchParams.get('list-type') === '2') {
      const names = [...objects.keys()].filter(key => key.startsWith(target.searchParams.get('prefix'))).sort()
      const start = Number(target.searchParams.get('continuation-token') || 0)
      const page = names.slice(start, start + 2)
      const more = start + 2 < names.length
      res.end('<ListBucketResult><IsTruncated>' + more + '</IsTruncated>' + page.map(key => '<Contents><Key>' + encodeURIComponent(key) + '</Key></Contents>').join('') +
        (more ? '<NextContinuationToken>' + (start+2) + '</NextContinuationToken>' : '') + '</ListBucketResult>')
      return
    }
    const key = target.pathname.slice('/fixture/'.length)
    if (req.method === 'PUT') {
      const signed = target.searchParams.get('X-Amz-SignedHeaders')?.split(';') ?? []
      if (req.headers['if-none-match'] !== '*' || objects.has(key) || !target.searchParams.has('X-Amz-Signature') ||
          !signed.includes('content-length') || !signed.includes('if-none-match')) { res.writeHead(412).end(); return }
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const bytes = Buffer.concat(chunks)
      if (bytes.length !== Number(req.headers['content-length'])) { res.writeHead(400).end(); return }
      objects.set(key, bytes)
      puts.push(key)
      res.end()
    } else if (req.method === 'GET' && req.headers.authorization && objects.has(key)) {
      if (damageNextRead) { damageNextRead = false; res.end('different'); return }
      res.end(objects.get(key))
    } else { res.writeHead(404).end() }
  })
  await new Promise((resolve, reject) => bucket.once('error', reject).listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => bucket.close(resolve)))
  const endpoint = 'http://127.0.0.1:' + bucket.address().port
  const env = { ...process.env, DATABASE_URL: url.href, MEDIA_DIR: root, MEDIAEX_S3_WORKSPACE_IDS: workspace, MEDIAEX_LEGACY_STORAGE: 'local',
    S3_ENDPOINT: endpoint, S3_REGION: 'us-east-1', S3_BUCKET: 'fixture', S3_ACCESS_KEY_ID: 'fixture-access', S3_SECRET_ACCESS_KEY: 'fixture-secret', S3_SESSION_TOKEN: '' }
  const cli = (...params) => run(process.execPath, ['--no-warnings','--experimental-strip-types','backend/migrate-media-storage.mts','--workspace',workspace,'--asset',id,...params], { env })
  await db.query('create table asset(id text primary key,"organizationId" text,"revisionId" uuid,status text,"deletedAt" timestamptz,"originalKey" text,size bigint,"mimeType" text,' +
    '"posterKey" text,"thumbKey" text,"playlistKey" text,playlists jsonb,"updatedAt" timestamptz); create table organization(id text primary key);' +
    'create table caption("assetId" text, key text, status text); create table asset_variant("assetId" text,key text); create table asset_revision("assetId" text)')
  await migrateStorage(db)
  await db.query("insert into media_store_binding(kind,location) values ('s3',$1) on conflict(kind) do update set location=excluded.location",[endpoint+'/fixture'])
  await db.query('insert into organization values ($1)',[workspace])
  await db.query('insert into asset(id,"organizationId","revisionId",status,"originalKey",size,"mimeType","playlistKey",playlists,"storageBackend") values ($1,$2,$3,\'ready\',$4,6,\'video/mp4\',$5,\'{}\',\'local\')',
    [id,workspace,randomUUID(),asset.originalKey,asset.required[0]])
  await db.query("insert into caption values ($1,$2,'ready')",[id,asset.required[1]])
  await db.query('insert into asset_variant values ($1,$2)',[id,asset.required[2]])
  const pointer = async () => (await db.query('select "storageBackend" from asset where id=$1',[id])).rows[0].storageBackend
  assert.match((await cli()).stdout, /eligible local inventory/)
  assert.equal(puts.length, 0)
  await assert.rejects(cli('--apply'), /Drain every MediaEX API/)
  damageNextRead = true
  await assert.rejects(cli('--apply','--writers-stopped'), /SHA-256 verification failed/)
  assert.equal(await pointer(), 'local')
  assert.equal(puts.length, 1)
  assert.match((await cli('--apply','--writers-stopped')).stdout, /copied and verified/)
  assert.equal(await pointer(), 's3')
  assert.equal(new Set(puts).size, 6)
  assert.equal(puts.length, 6)
  assert.match((await cli('--apply','--writers-stopped')).stdout, /already on destination/)
  assert.equal(puts.length, 6)
  objects.set(prefix + '/new-caption.vtt', Buffer.from('new'))
  await assert.rejects(cli('--rollback','--apply','--writers-stopped'), /additional objects/)
  assert.equal(await pointer(), 's3')
  objects.delete(prefix + '/new-caption.vtt')
  assert.match((await cli('--rollback','--apply','--writers-stopped')).stdout, /rolled back/)
  assert.equal(await pointer(), 'local')
  assert.equal(objects.size, 6)
  assert.equal(await readFile(path.join(root,asset.originalKey),'utf8'), 'source')
})
