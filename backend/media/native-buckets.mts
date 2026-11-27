import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { HttpError } from './assets.mts'
import { multipart, streamParts, upgradeCatalog, PART_BYTES } from './native-multipart.mts'

const MAX_OBJECT = PART_BYTES
const privateHeaders = { 'Cache-Control': 'private, no-store' }

function filename(orgId: string) {
  const root = process.env.MEDIA_DIR || (process.env.NODE_ENV !== 'production' && '.media')
  if (!root) return null
  const workspace = createHash('sha256').update(orgId).digest('hex')
  return path.resolve(root, '.native-buckets', workspace + '.sqlite')
}

function openCatalog(orgId: string, create = false) {
  const file = filename(orgId)
  if (!file || (!create && !existsSync(file))) return null
  if (create) mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try {
    db.exec('pragma busy_timeout=1500')
    if (create) db.exec(`
      create table if not exists bucket(name text primary key);
      create table if not exists object(
        bucket text not null references bucket(name), key text not null,
        bytes blob not null, etag text not null, primary key(bucket,key)
      ) without rowid;
    `)
    upgradeCatalog(db)
    return db
  } catch (error) { db.close(); throw error }
}

export function bucketUsage(orgId: string) {
  const db = openCatalog(orgId)
  if (!db) return 0
  try { return Number(db.prepare('select (select coalesce(sum(length(bytes)),0) from object) + (select coalesce(sum(length(bytes)),0) from part) as total').get()!.total) }
  finally { db.close() }
}

async function readUpload(req: Request) {
  if (Number(req.headers.get('content-length')) > MAX_OBJECT) throw new HttpError(413, 'Single object limit is 8 MiB.')
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = req.body?.getReader()
  if (reader) try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.length
      if (size > MAX_OBJECT) {
        await reader.cancel()
        throw new HttpError(413, 'Single object limit is 8 MiB.')
      }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, size)
}

// The caller serializes writes with ordinary media uploads under the existing workspace quota lock.
type WriteLock = (run: (checkQuota: (additional: number) => Promise<void>) => Promise<Response>) => Promise<Response>

export async function nativeBuckets(req: Request, orgId: string, parts: string[], write: WriteLock) {
  const [name, resource] = parts
  const method = req.method
  const params = new URL(req.url).searchParams
  if (!filename(orgId)) throw new HttpError(503, 'Mount a persistent MEDIA_DIR to enable native buckets.')
  const uploads = resource === 'uploads'
  if (parts.length > 2 || (resource && resource !== 'objects' && !uploads)) throw new HttpError(404, 'Unknown bucket route.')
  if (name && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) throw new HttpError(400, 'Use a 3 to 63 character lowercase bucket name.')
  const key = params.get('key')
  if (key !== null && (!resource || !key || key.includes('\0') || Buffer.byteLength(key) > 1024)) throw new HttpError(400, 'Invalid object key.')
  const list = method === 'GET' && key === null
  const create = !!name && !resource && method === 'PUT'
  const put = !!resource && key !== null && method === 'PUT'
  const remove = !!name && (!resource || key !== null) && method === 'DELETE'
  const download = !!resource && key !== null && ['GET','HEAD'].includes(method)
  if (!(uploads || list || create || put || remove || download)) throw new HttpError(405, 'Unsupported bucket operation.')
  const data = put || (uploads && method === 'PUT') ? await readUpload(req) : null
  const json = (body: unknown) => Response.json(body, { headers: privateHeaders })
  const empty = () => new Response(null, { status: 204 })
  async function execute(checkQuota: (additional: number) => Promise<void>) {
    const db = openCatalog(orgId, create)
    if (!db) {
      if (!name && list) return json({ buckets: [] })
      throw new HttpError(404, 'Bucket does not exist.')
    }
    let streamOwnsCatalog = false
    try {
      if (method !== 'GET' && method !== 'HEAD') db.prepare('delete from upload where etag is null and expires<=?').run(Date.now())
      if (!name) return json({ buckets: db.prepare('select name from bucket order by name').all() })
      if (create) {
        db.prepare('insert into bucket(name) values (?) on conflict do nothing').run(name)
        return empty()
      }
      if (!db.prepare('select 1 from bucket where name=?').get(name)) throw new HttpError(404, 'Bucket does not exist.')
      if (uploads) return await multipart(db,req,name,key,params,data,checkQuota)
      if (!resource && remove) {
        if (db.prepare('select 1 from upload where bucket=? and etag is null limit 1').get(name)) throw new HttpError(409,'Abort pending uploads before deleting this bucket.')
        if (db.prepare('select 1 from object where bucket=? limit 1').get(name)) throw new HttpError(409, 'Empty the bucket before deleting it.')
        db.prepare('delete from bucket where name=?').run(name)
        return empty()
      }
      if (list) {
        const prefix = params.get('prefix') ?? ''
        const after = params.get('after') ?? ''
        const limit = Number(params.get('limit') ?? 100)
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new HttpError(400, 'Limit must be between 1 and 1000.')
        const rows = db.prepare('select key,coalesce(total,length(bytes)) as size,etag from object where bucket=? and key>? and substr(key,1,length(?))=? order by key limit ?').all(name, after, prefix, prefix, limit+1)
        return json({ objects: rows.slice(0,limit), nextAfter: rows.length > limit ? rows[limit-1].key : null })
      }
      if (data !== null) {
        const existing = db.prepare('select coalesce(total,length(bytes)) as size from object where bucket=? and key=?').get(name,key)
        if (existing && req.headers.get('if-none-match') === '*') throw new HttpError(412, 'Object already exists.')
        await checkQuota(data.length - Number(existing?.size ?? 0))
        const etag = '"' + createHash('sha256').update(data).digest('hex') + '"'
        db.prepare('insert into object(bucket,key,bytes,etag) values (?,?,?,?) on conflict(bucket,key) do update set bytes=excluded.bytes,etag=excluded.etag,multipart=null,total=null').run(name,key,data,etag)
        return new Response(null, { status: 204, headers: { ETag: etag } })
      }
      if (remove) {
        db.prepare('delete from object where bucket=? and key=?').run(name,key)
        return empty()
      }
      // Read metadata and bytes from one snapshot so an overwrite cannot mix revisions.
      db.exec('begin')
      const object = db.prepare('select coalesce(total,length(bytes)) as size,etag,multipart from object where bucket=? and key=?').get(name,key)
      if (!object) throw new HttpError(404, 'Object does not exist.')
      const size = Number(object.size)
      const headers = new Headers({ ...privateHeaders, ETag: String(object.etag), 'Accept-Ranges':'bytes', 'Content-Type':'application/octet-stream', 'Content-Disposition':'attachment' })
      if (req.headers.get('if-none-match') === object.etag) return new Response(null,{status:304,headers})
      let start = 0, end = size - 1
      const range = req.headers.get('range')
      if (range !== null) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (match && (match[1] || match[2])) {
          start = match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]))
          end = match[1] && match[2] ? Math.min(end,Number(match[2])) : end
        } else start = size
        if (start > end) return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}})
        headers.set('Content-Range',`bytes ${start}-${end}/${size}`)
      }
      const length = end-start+1
      headers.set('Content-Length',String(length))
      if (method !== 'HEAD' && object.multipart) {
        const body = streamParts(db,String(object.multipart),start,end)
        streamOwnsCatalog = true
        return new Response(body,{status:range === null ? 200 : 206,headers})
      }
      const bytes = method === 'HEAD' ? null : db.prepare('select substr(bytes,?,?) as data from object where bucket=? and key=?').get(start+1,length,name,key)!.data as Uint8Array<ArrayBuffer>
      return new Response(bytes,{status:range === null ? 200 : 206,headers})
    } finally { if (!streamOwnsCatalog) db.close() }
  }
  return ['PUT','POST','DELETE'].includes(method) ? write(execute) : execute(async () => {})
}
