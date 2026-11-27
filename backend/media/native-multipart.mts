import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from './assets.mts'

export const PART_BYTES = 8 * 1024 * 1024
export const RELAY_PART_BYTES = 1024 * 1024
const MAX_PARTS = 10_000
const TTL = 7 * 24 * 60 * 60 * 1000

export function upgradeCatalog(db: DatabaseSync) {
  if (db.prepare('pragma user_version').get()?.user_version === 1) return
  db.exec('pragma journal_mode=wal; begin immediate')
  try {
    if (db.prepare('pragma user_version').get()?.user_version === 0) db.exec(`
      alter table object add column multipart text;
      alter table object add column total integer;
      create table upload(
        id text primary key, bucket text not null references bucket(name) on delete cascade,
        key text not null, size integer not null, part_size integer not null, expires integer not null, etag text, create_only integer not null
      );
      create index upload_expiry on upload(expires) where etag is null;
      create index upload_bucket on upload(bucket);
      create table part(upload text not null references upload(id) on delete cascade,
        number integer not null, hash text not null, bytes blob not null, primary key(upload,number)) without rowid;
      create trigger remove_chunks after delete on object when old.multipart is not null begin
        delete from upload where id=old.multipart;
      end;
      create trigger replace_chunks after update of multipart on object when old.multipart is not null and old.multipart is not new.multipart begin
        delete from upload where id=old.multipart;
      end;
      pragma user_version=1;
    `)
    db.exec('commit')
  } catch (error) { db.exec('rollback'); throw error }
}

export async function multipart(db: DatabaseSync, req: Request, bucket: string, key: string | null, params: URLSearchParams,
  data: Buffer | null, checkQuota: (delta: number) => Promise<void>) {
  const method = req.method
  const id = params.get('uploadId')
  const json = (body: unknown, status = 200) => Response.json(body,{status, headers:{'Cache-Control':'no-store'}})
  const now = Date.now()
  if (!id && method === 'POST' && key) {
    const size = Number(params.get('size'))
    const partSize = Number(params.get('partSize') ?? RELAY_PART_BYTES)
    if (![RELAY_PART_BYTES,PART_BYTES].includes(partSize)) throw new HttpError(400,'Choose 1 MiB or 8 MiB parts.')
    if (!Number.isSafeInteger(size) || size < 1 || size > partSize * MAX_PARTS) throw new HttpError(400,'Invalid multipart size.')
    const uploadId = randomUUID()
    db.prepare('insert into upload(id,bucket,key,size,part_size,expires,create_only) values (?,?,?,?,?,?,?)')
      .run(uploadId,bucket,key,size,partSize,now+TTL,Number(req.headers.get('if-none-match') === '*'))
    return json({uploadId,partSize,size,expiresAt:now+TTL},201)
  }
  if (!id || key !== null) throw new HttpError(400,'Supply an uploadId for an existing upload.')
  const u = db.prepare('select * from upload where id=? and bucket=?').get(id,bucket)
  if (!u || (!u.etag && Number(u.expires)<=now)) throw new HttpError(404,'Upload does not exist or has expired.')
  const partSize = Number(u.part_size)
  const count = Math.ceil(Number(u.size)/partSize)
  if (method === 'GET') {
    const parts = db.prepare('select number,hash as sha256,length(bytes) as size from part where upload=? order by number').all(id)
    return json({uploadId:id,key:u.key,size:u.size,partSize,expiresAt:u.etag ? null : u.expires,etag:u.etag,parts})
  }
  if (method === 'POST' && u.etag) return json({etag:u.etag,size:u.size})
  if (u.etag) throw new HttpError(409,'Upload is already complete.')
  if (method === 'DELETE') {
    db.prepare('delete from upload where id=?').run(id)
    return new Response(null,{status:204})
  }
  if (method === 'PUT' && data) {
    const number = Number(params.get('part'))
    if (!Number.isInteger(number) || number<1 || number>count) throw new HttpError(400,'Invalid part number.')
    const expected = number===count ? Number(u.size)-(count-1)*partSize : partSize
    if (data.length!==expected) throw new HttpError(400,'Part length differs from the declared upload.')
    const hash = createHash('sha256').update(data).digest('hex')
    if (params.has('sha256') && params.get('sha256')!==hash) throw new HttpError(400,'Part checksum mismatch.')
    const existing = db.prepare('select hash from part where upload=? and number=?').get(id,number)
    if (existing && existing.hash!==hash) throw new HttpError(409,'Part already contains different bytes.')
    if (!existing) await checkQuota(data.length)
    db.exec('begin immediate')
    try {
      if (!existing) db.prepare('insert into part values (?,?,?,?)').run(id,number,hash,data)
      db.prepare('update upload set expires=? where id=?').run(now+TTL,id)
      db.exec('commit')
    } catch (error) { db.exec('rollback'); throw error }
    return json({number,sha256:hash,size:data.length})
  }
  if (method !== 'POST') throw new HttpError(405,'Unsupported multipart operation.')
  db.exec('begin immediate')
  try {
    const parts = db.prepare('select hash from part where upload=? order by number').all(id)
    if (parts.length!==count) throw new HttpError(409,'Some upload parts are missing.')
    if (u.create_only && db.prepare('select 1 from object where bucket=? and key=?').get(bucket,u.key)) throw new HttpError(412,'Object already exists.')
    const digest = createHash('sha256')
    for (const part of parts) digest.update(Buffer.from(String(part.hash),'hex'))
    const etag = '"' + digest.digest('hex') + '-' + count + '"'
    db.prepare("insert into object(bucket,key,bytes,etag,multipart,total) values (?,?,x'',?,?,?) on conflict(bucket,key) do update set bytes=excluded.bytes,etag=excluded.etag,multipart=excluded.multipart,total=excluded.total")
      .run(bucket,u.key,etag,id,u.size)
    db.prepare('update upload set etag=? where id=?').run(etag,id)
    db.exec('commit')
    return json({etag,size:u.size})
  } catch (error) { db.exec('rollback'); throw error }
}

// Keep the read transaction until the last requested chunk or cancellation.
export function streamParts(db: DatabaseSync, id: string, start: number, end: number) {
  const partSize = Number(db.prepare('select part_size from upload where id=?').get(id)!.part_size)
  const read = db.prepare('select substr(bytes,?,?) as data from part where upload=? and number=?')
  let offset = start
  let closed = false
  function close() { if (!closed) { closed=true; db.close() } }
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        const within = offset % partSize
        const length = Math.min(end-offset+1,partSize-within,1024*1024)
        const row = read.get(within+1,length,id,Math.floor(offset/partSize)+1)
        if (!(row?.data instanceof Uint8Array) || row.data.byteLength!==length) throw Error('Incomplete object storage.')
        controller.enqueue(row.data)
        offset += length
        if (offset>end) { controller.close(); close() }
      } catch (error) { close(); controller.error(error) }
    },
    cancel: close,
  })
}
