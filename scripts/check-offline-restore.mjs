import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MEDIA_SCHEMA } from '../backend/media/schema.mts'

// Offline fixture drill. Both PostgreSQL and media are quiescent at the snapshot point.
// Single-user mode needs no listener and can never connect to a production database.
const scratch = await mkdtemp(path.join(process.env.RESTORE_DRILL_TMP || tmpdir(), 'mediaex-restore-'))
const source = path.join(scratch, 'source')
const replacement = path.join(scratch, 'replacement')
function run(command, args, input) {
  const r = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 })
  if (r.error) throw r.error
  if (r.status !== 0 || /(?:ERROR|FATAL|PANIC):/.test(r.stderr)) throw Error(command + ' failed: ' + r.stderr.slice(-1200))
  return r.stdout
}
function query(host, sql) {
  return run('postgres', ['--single', '-D', path.join(host, 'db'), 'postgres'], sql + '\n')
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
  await Promise.all([mkdir(photo, {recursive:true}), mkdir(video, {recursive:true}), mkdir(replacement)])
  const pass = path.join(scratch, 'password')
  await writeFile(pass, randomBytes(32).toString('hex'), { mode: 0o600 })
  run('initdb', ['-D',path.join(source,'db'),'-U','drill','-A','scram-sha-256','--pwfile='+pass,'--encoding=UTF8','--locale=C'])
  const ff = args => run('ffmpeg', ['-hide_banner','-loglevel','error',...args])
  ff(['-f','lavfi','-i','testsrc2=size=800x600','-frames:v','1',path.join(photo,'original.jpg')])
  ff(['-i',path.join(photo,'original.jpg'),'-vf','scale=320:-1','-frames:v','1',path.join(photo,'thumb.jpg')])
  ff(['-f','lavfi','-i','testsrc2=size=128x72:rate=12','-t','2','-c:v','libx264','-g','12',path.join(video,'original.mp4')])
  ff(['-i',path.join(video,'original.mp4'),'-c','copy','-hls_time','1','-hls_list_size','0',path.join(video,'index.m3u8')])
  const schema = MEDIA_SCHEMA.replace(/--[^\n]*/g,'').replace(/\s+/g,' ')
  query(source, [
    'create table organization (id text primary key);',
    'create table "user" (id text primary key);',
    schema,
    "insert into organization values ('pilot');",
    "insert into asset(id,\"organizationId\",title,type,status,\"fileName\",\"originalKey\",\"thumbKey\",\"playlistKey\",playback) values ('cover','pilot','Venue','image','ready','original.jpg','pilot/cover/original.jpg','pilot/cover/thumb.jpg',null,'public'),('video','pilot','Trailer','video','ready','original.mp4','pilot/video/original.mp4',null,'pilot/video/index.m3u8','signed');",
  ].join('\n'))
  const catalog = host => query(host, "select string_agg(concat_ws('|',id,\"organizationId\",type,status,\"originalKey\",\"thumbKey\",\"playlistKey\",playback),';' order by id) as catalog from asset;").match(/catalog = "([^"]+)"/)?.[1]
  const expected = catalog(source)
  assert.match(expected, /pilot\/video\/index.m3u8\|signed/)
  const expectedFiles = await inventory(path.join(source,'media'))
  const archive = path.join(scratch,'backup.tar')
  run('tar',['-cf',archive,'-C',source,'db','media'])
  const start = performance.now()
  run('tar',['-xf',archive,'-C',replacement])
  assert.equal(catalog(replacement),expected)
  assert.deepEqual(await inventory(path.join(replacement,'media')),expectedFiles)
  ff(['-i',path.join(replacement,'media/pilot/video/index.m3u8'),'-f','null','-'])
  ff(['-i',path.join(replacement,'media/pilot/cover/thumb.jpg'),'-f','null','-'])
  console.log(JSON.stringify({fixtureAssets:2,verifiedFiles:expectedFiles.length,recoveryMs:Math.round(performance.now()-start),missingFiles:0,missingCatalogEntries:0}))
} finally {
  await rm(scratch,{recursive:true,force:true})
}
