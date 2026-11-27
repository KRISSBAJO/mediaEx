import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RECOVERY_SCHEMA } from '../backend/media/recovery-schema.mts'
import { MEDIA_SCHEMA } from '../backend/media/schema.mts'

// Offline fixture drill. Both PostgreSQL and media are quiescent at the snapshot point.
// Route checks open only a private Unix socket in the disposable cluster directory.
const scratch = await mkdtemp(path.join(process.env.RESTORE_DRILL_TMP || tmpdir(), 'mediaex-restore-'))
const source = path.join(scratch, 'source')
const replacement = path.join(scratch, 'replacement')
function run(command, args, input, env = process.env) {
  const r = spawnSync(command, args, { input, env, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 })
  if (r.error) throw r.error
  if (r.status !== 0 || /(?:ERROR|FATAL|PANIC):/.test(r.stderr)) throw Error(command + ' failed: ' + r.stderr.slice(-1200))
  return r.stdout
}
function query(host, sql) {
  return run('postgres', ['--single', '-D', path.join(host, 'db'), 'postgres'], sql + '\n')
}
async function verifyExportedLinks(phase) {
  const host = path.join(scratch, phase)
  const raw = query(host, `select encode(convert_to(json_build_object('assets', (select json_agg(row_to_json(a)) from asset a),
    'secret', (select "playbackSecret" from workspace_setting where "organizationId"='pilot'))::text,'UTF8'),'hex') as fixture;`.replace(/\s+/g, ' '))
  const payload = raw.match(/fixture = "([0-9a-f]+)"/)?.[1]
  assert.ok(payload, 'Fixture catalog export failed')
  const script = fileURLToPath(new URL('./verify-restored-links.mjs', import.meta.url))
  run(process.execPath, [script, phase, scratch], Buffer.from(payload, 'hex'), {
    PATH: process.env.PATH, BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  })
}
async function verifyLinks(phase) {
  if (!process.argv.includes('--live-db')) return verifyExportedLinks(phase)
  const db = path.join(scratch, phase, 'db')
  const script = fileURLToPath(new URL('./verify-restored-links.mjs', import.meta.url))
  const log = path.join(scratch, phase + '.log')
  try {
    run('pg_ctl', ['-D', db, '-l', log, '-o', "-c listen_addresses='' -k . -p 5432", '-w', 'start'])
  } catch (error) {
    console.error(await readFile(log, 'utf8').catch(() => 'No fixture database log'))
    throw error
  }
  try {
    run(process.execPath, [script, phase, scratch, '--live-db'], undefined, {
      PATH: process.env.PATH, BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    })
  } finally {
    run('pg_ctl', ['-D', db, '-m', 'fast', '-w', 'stop'])
  }
}
async function inventory(folder) {
  const files = await readdir(folder, { recursive: true, withFileTypes: true })
  return Promise.all(files.filter(f => f.isFile()).map(async f => {
    const file = path.join(f.parentPath, f.name)
    return [path.relative(folder, file), createHash('sha256').update(await readFile(file)).digest('hex')]
  })).then(rows => rows.sort((a,b) => a[0].localeCompare(b[0])))
}
try {
  const photo = path.join(source, 'media', 'pilot', 'cover')
  const video = path.join(source, 'media', 'pilot', 'video')
  await Promise.all([mkdir(photo, {recursive:true}), mkdir(path.join(video,'hls'), {recursive:true}), mkdir(replacement)])
  const pass = path.join(scratch, 'password')
  await writeFile(pass, randomBytes(32).toString('hex'), { mode: 0o600 })
  run('initdb', ['-D',path.join(source,'db'),'-U','drill','-A','scram-sha-256','--pwfile='+pass,'--encoding=UTF8','--locale=C'])
  const ff = args => run('ffmpeg', ['-hide_banner','-loglevel','error',...args])
  ff(['-f','lavfi','-i','testsrc2=size=800x600','-frames:v','1',path.join(photo,'original.jpg')])
  ff(['-i',path.join(photo,'original.jpg'),'-vf','scale=320:-1','-frames:v','1',path.join(photo,'thumb.jpg')])
  ff(['-f','lavfi','-i','testsrc2=size=128x72:rate=12','-t','2','-c:v','libx264','-g','12',path.join(video,'original.mp4')])
  ff(['-i',path.join(video,'original.mp4'),'-c','copy','-hls_time','1','-hls_list_size','0',path.join(video,'hls/index.m3u8')])
  const schema = (MEDIA_SCHEMA + RECOVERY_SCHEMA).replace(/--[^\n]*/g,'').replace(/\s+/g,' ')
  query(source, [
    'create table organization (id text primary key);',
    'create table "user" (id text primary key, name text);',
    schema,
    'alter table asset add column "storageBackend" text not null default \'local\';',
    "insert into organization values ('pilot');",
    `insert into workspace_setting ("organizationId", "playbackSecret") values ('pilot','${randomBytes(32).toString('hex')}');`,
    "insert into asset(id,\"organizationId\",title,type,status,\"fileName\",\"originalKey\",\"thumbKey\",\"playlistKey\",playback) values ('ast_cover01','pilot','Venue','image','ready','original.jpg','pilot/cover/original.jpg','pilot/cover/thumb.jpg',null,'public'),('ast_video01','pilot','Trailer','video','ready','original.mp4','pilot/video/original.mp4',null,'pilot/video/hls/index.m3u8','signed');",
  ].join('\n'))
  const catalog = host => query(host, "select string_agg(concat_ws('|',id,\"organizationId\",type,status,\"originalKey\",\"thumbKey\",\"playlistKey\",playback),';' order by id) as catalog from asset;").match(/catalog = "([^"]+)"/)?.[1]
  await verifyLinks('source')
  const expected = catalog(source)
  assert.match(expected, /pilot\/video\/hls\/index.m3u8\|signed/)
  const expectedFiles = await inventory(path.join(source,'media'))
  const archive = path.join(scratch,'backup.tar')
  run('tar',['-cf',archive,'-C',source,'db','media'])
  const start = performance.now()
  run('tar',['-xf',archive,'-C',replacement])
  assert.equal(catalog(replacement),expected)
  assert.deepEqual(await inventory(path.join(replacement,'media')),expectedFiles)
  ff(['-i',path.join(replacement,'media/pilot/video/hls/index.m3u8'),'-f','null','-'])
  ff(['-i',path.join(replacement,'media/pilot/cover/thumb.jpg'),'-f','null','-'])
  await verifyLinks('replacement')
  console.log(JSON.stringify({preSnapshotLinksVerified:true,anonymousDenialsVerified:true,fixtureAssets:2,verifiedFiles:expectedFiles.length,recoveryMs:Math.round(performance.now()-start),missingFiles:0,missingCatalogEntries:0}))
} finally {
  await rm(scratch,{recursive:true,force:true})
}
