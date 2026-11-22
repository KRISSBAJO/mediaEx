/**
 * Run in the backend image with DATABASE_URL and the mounted MEDIA_DIR.
 * --workspace <id> [--asset <id>] [--rollback] [--apply --writers-stopped]
 * Stop/drain all MediaEX APIs, workers and direct writes to this prefix before apply
 * or rollback. GET transform requests also write. An interrupted copy is resumable.
 */
import { parseArgs } from 'node:util'
import { pool } from './auth.mts'
import type { PoolClient } from 'pg'
import { storage } from './media/storage.mts'
import { eligible, localInventory, verifyBucket, type MigrationAsset } from './media/storage-transfer.mts'

const { values: opt } = parseArgs({ options: {
  workspace: { type: 'string' }, asset: { type: 'string' }, apply: { type: 'boolean' },
  rollback: { type: 'boolean' }, 'writers-stopped': { type: 'boolean' }, help: { type: 'boolean' },
} })
const rollback = Boolean(opt.rollback)
const log = (result: object) => console.log(JSON.stringify(result))

async function candidate(db: PoolClient, workspace: string, id: string, locked = false) {
  const sql = [
    'select a.*, exists(select 1 from asset_revision where "assetId"=a.id) as versioned,',
    'exists(select 1 from caption where "assetId"=a.id and status in (\'queued\',\'processing\')) as "captionPending",',
    'array_remove(array[a."thumbKey",a."posterKey",a."playlistKey"] || ',
    'array(select value from jsonb_each_text(coalesce(a.playlists,\'{}\'::jsonb))) ||',
    'array(select key from caption where "assetId"=a.id and status=\'ready\') || array(select key from asset_variant where "assetId"=a.id), null) as required,',
    'md5(to_jsonb(a)::text) as fingerprint, (select t.digest from media_store_transfer t where t."assetId"=a.id',
    'and t."organizationId"=a."organizationId" and t."revisionId"=a."revisionId"::text and t.prefix=a."organizationId"||\'/\'||a.id and t."rolledBackAt" is null) as receipt',
    'from asset a where a.id=$2 and a."organizationId"=$1', locked ? 'for update of a' : '',
  ].join(' ')
  const { rows } = await db.query<MigrationAsset>(sql, [workspace,id])
  return rows[0]
}

async function move(db: PoolClient, workspace: string, id: string) {
  const before = await candidate(db, workspace, id)
  if (!before) throw new Error('Asset is unavailable in the selected workspace.')
  const skip = eligible(before, rollback)
  if (skip) return log({ asset: id, skipped: skip })
  const directory = process.env.MEDIA_DIR || '.media'
  const inventory = await localInventory(directory, before)
  if (rollback && before.receipt !== inventory.digest) throw new Error('Retained disk content changed since migration.')
  const result = { asset: id, objects: inventory.files.length, bytes: inventory.bytes, sha256: inventory.digest }
  if (!opt.apply) return log({ ...result, result: rollback ? 'local rollback inventory verified' : 'eligible local inventory' })
  const bucket = storage({ storageBackend: 's3', organizationId: before.organizationId })
  await verifyBucket(bucket, inventory, before, rollback)
  // Re-read all local keys and bytes to detect a changing mount before switching.
  if ((await localInventory(directory, before)).digest !== inventory.digest) throw new Error('Disk inventory changed during verification.')
  await db.query('begin')
  try {
    const current = await candidate(db, workspace, id, true)
    if (!current || eligible(current, rollback) || current.fingerprint !== before.fingerprint ||
        current.receipt !== before.receipt || JSON.stringify(current.required.sort()) !== JSON.stringify(before.required.sort()))
      throw new Error('Asset metadata changed during verification. Retry from the current state.')
    const previous = rollback ? 's3' : 'local'
    const next = rollback ? 'local' : 's3'
    const update = await db.query('update asset set "storageBackend"=$4,"updatedAt"=now() where "organizationId"=$1 and id=$2 and "storageBackend"=$3 and "revisionId"=$5',
      [workspace,id,previous,next,before.revisionId])
    if (update.rowCount !== 1) throw new Error('Storage pointer changed concurrently.')
    if (rollback) {
      const receipt = await db.query('update media_store_transfer set "rolledBackAt"=now() where "assetId"=$1 and digest=$2 and "revisionId"=$3 and "rolledBackAt" is null', [id,inventory.digest,before.revisionId])
      if (receipt.rowCount !== 1) throw new Error('Migration receipt changed concurrently.')
    } else {
      const receipt = await db.query('insert into media_store_transfer ("assetId","organizationId","revisionId",digest,objects,bytes,prefix) values ($1,$2,$3,$4,$5,$6,$7) ' +
        'on conflict ("revisionId") do update set digest=excluded.digest,objects=excluded.objects,bytes=excluded.bytes,"migratedAt"=now(),"rolledBackAt"=null ' +
        'where media_store_transfer."assetId"=excluded."assetId" and media_store_transfer."organizationId"=excluded."organizationId" and media_store_transfer.prefix=excluded.prefix',
        [id,workspace,before.revisionId,inventory.digest,inventory.files.length,inventory.bytes,inventory.prefix])
      if (receipt.rowCount !== 1) throw new Error('The recorded revision belongs to another asset or storage prefix.')
    }
    await db.query('commit')
    log({ ...result, result: rollback ? 'rolled back' : 'copied and verified' })
  } catch (error) {
    await db.query('rollback')
    throw error
  }
}

async function main() {
  if (opt.help) {
    console.log('node --experimental-strip-types migrate-media-storage.mts --workspace ID [--asset ID] [--rollback] [--apply --writers-stopped]')
    return
  }
  const workspace = opt.workspace
  if (!workspace || !/^[A-Za-z0-9_-]+$/.test(workspace)) throw new Error('Supply one --workspace ID.')
  if (opt.apply && !opt['writers-stopped']) throw new Error('Drain every MediaEX API and worker and stop direct media writes, then pass --writers-stopped.')
  if (opt.apply && !rollback && !process.env.MEDIAEX_S3_WORKSPACE_IDS?.split(',').map(id => id.trim()).includes(workspace))
    throw new Error('This workspace is outside the explicit S3 pilot allowlist.')
  const db = await pool.connect()
  try {
    if (!(await db.query('select 1 from organization where id=$1',[workspace])).rowCount) throw new Error('Workspace does not exist.')
    if (opt.apply) {
      const location = (process.env.S3_ENDPOINT ?? '').replace(/\/+$/, '') + '/' + (process.env.S3_BUCKET ?? '')
      const { rows } = await db.query('select location from media_store_binding where kind=\'s3\'')
      if (!rows[0] || rows[0].location !== location) throw new Error('The configured bucket differs from the database binding.')
      const { rows: [lock] } = await db.query('select pg_try_advisory_lock(hashtext($1),hashtext($2)) as acquired', ['mediaex.store.transfer',workspace])
      if (!lock.acquired) throw new Error('Another migration is running in this workspace.')
    }
    if (opt.asset) return await move(db, workspace, opt.asset)
    let last = ''
    while (true) {
      const { rows } = await db.query<{ id: string }>('select id from asset where "organizationId"=$1 and id>$2 order by id limit 100', [workspace,last])
      if (!rows.length) break
      for (const { id } of rows) await move(db, workspace, id)
      last = rows[rows.length-1].id
    }
  } finally {
    db.release(true)
  }
}
try { await main() }
catch (error) { console.error(error instanceof Error ? error.message : 'Media storage migration failed.'); process.exitCode = 1 }
finally { await pool.end() }
