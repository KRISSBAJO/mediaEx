/**
 * Where media files live.
 *
 * - Local disk (default): files under MEDIA_DIR (default ./.media). Good for development and single-server installs
 *   with a persistent volume. Uploads stream through the app.
 * - S3-compatible bucket (Cloudflare R2, AWS S3, MinIO, …) when S3_BUCKET is set. Browsers upload straight to the
 *   bucket with a presigned URL; playback segments are served by short-lived presigned redirects.
 *
 * Keys look like `<workspaceId>/<assetId>/original.mov`, `<workspaceId>/<assetId>/hls/v0/seg_001.ts`.
 */
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AwsClient } from 'aws4fetch'

const TYPES: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  m4s: 'video/iso.segment',
  mp4: 'video/mp4',
  aac: 'audio/aac',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  vtt: 'text/vtt',
}
export const contentType = (key: string) => TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'

/** Keys are built by the server, but paths from URLs are checked against this before touching storage. */
export const SAFE_KEY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9._-]+)*$/
const assertKey = (key: string) => {
  if (!SAFE_KEY.test(key) || key.split('/').some((p) => p === '.' || p === '..')) throw new Error(`Unsafe storage key: ${key}`)
}

export type UploadTarget = { url: string; method: 'PUT'; headers: Record<string, string> }
/** Only the playback authorizer may supply expiresAt (absolute Unix seconds). */
export type DeliveryAccess = 'public' | 'member' | { expiresAt: number }
type ServeOptions = { access: DeliveryAccess; download?: string }
const privateCache = 'private, no-store'
const grantExpired = (access: DeliveryAccess) => typeof access === 'object' && access.expiresAt <= Date.now() / 1000
const unavailable = () => new Response(null, { status: 404, headers: { 'Cache-Control': privateCache } })
/** a part already stored for a multipart upload */
export type StoredPart = { number: number; size: number; etag: string }

export interface Storage {
  kind: 'local' | 's3'
  /** where the browser PUTs the original file */
  uploadTarget(key: string, assetId: string, bytes: number): Promise<UploadTarget>
  /** size in bytes, or null when the object doesn't exist */
  size(key: string): Promise<number | null>
  /** a path on this machine the worker can read; downloads to `scratch` when the file isn't local */
  localCopy(key: string, scratch: string): Promise<string>
  /** directory the worker should write outputs into for `prefix`, and how to publish them afterwards */
  outputDir(prefix: string, scratch: string): Promise<{ dir: string; publish: () => Promise<void> }>
  /** answer a GET for a stored file (range requests supported) */
  serve(key: string, req: Request, opts: ServeOptions): Promise<Response>
  /** delete everything under a prefix */
  removePrefix(prefix: string): Promise<void>
  /** delete one file (no error when it's already gone) */
  remove(key: string): Promise<void>
  /** store a generated file (transformations) */
  putBuffer(key: string, data: Buffer, type: string): Promise<void>
  /** read a whole stored file into memory (small files only), or null when it doesn't exist */
  getBuffer(key: string): Promise<Buffer | null>
  /** something FFmpeg can open directly: a local path, or a short-lived signed URL it can range-request */
  readableUrl(key: string): Promise<string>

  /* multipart uploads (large files, resumable): start, send parts, list what arrived, join them, or give up */
  multipartStart(key: string): Promise<string>
  /** where to PUT part `n` (1-based); local storage answers with the app's own upload route */
  partTarget(key: string, uploadId: string, n: number, assetId: string, bytes: number): Promise<UploadTarget>
  listParts(key: string, uploadId: string): Promise<StoredPart[]>
  multipartComplete(key: string, uploadId: string, parts: StoredPart[]): Promise<void>
  multipartAbort(key: string, uploadId: string): Promise<void>
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

/* ------------------------------------------------ local disk */
class LocalStorage implements Storage {
  kind = 'local' as const
  readonly root: string
  constructor(root: string) {
    this.root = root
  }

  path(key: string) {
    assertKey(key)
    return path.join(this.root, ...key.split('/'))
  }

  async uploadTarget(_key: string, assetId: string): Promise<UploadTarget> {
    return { url: `/api/uploads/${assetId}`, method: 'PUT', headers: {} }
  }

  /** used by the upload route: stream a request body to disk, refusing more than `max` bytes */
  async write(key: string, body: ReadableStream<Uint8Array>, max: number) {
    const file = this.path(key)
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.part`
    let n = 0
    const counter = async function* (src: AsyncIterable<Uint8Array>) {
      for await (const chunk of src) {
        n += chunk.length
        if (n > max) throw new Error('UPLOAD_TOO_LARGE')
        yield chunk
      }
    }
    try {
      await pipeline(Readable.fromWeb(body as never), counter, createWriteStream(tmp))
      await rename(tmp, file)
      return n
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }
  }

  async size(key: string) {
    try {
      return (await stat(this.path(key))).size
    } catch {
      return null
    }
  }

  async localCopy(key: string) {
    return this.path(key)
  }

  async outputDir(prefix: string) {
    // write straight into place: nothing to copy afterwards
    const dir = this.path(prefix)
    await mkdir(dir, { recursive: true })
    return { dir, publish: async () => {} }
  }

  async serve(key: string, req: Request, opts: ServeOptions) {
    const file = this.path(key)
    let st
    try {
      st = await stat(file)
    } catch {
      return unavailable()
    }
    if (grantExpired(opts.access)) return unavailable()
    const headers = new Headers({
      'Content-Type': contentType(key),
      'Accept-Ranges': 'bytes',
      // playlists can change while an asset is re-processed; segments and images never change under the same name
      'Cache-Control': opts.access !== 'public' ? privateCache : key.endsWith('.m3u8') ? 'no-cache' : 'private, max-age=3600',
    })
    if (opts.download) headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`)

    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '')
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : st.size - Number(m[2])
      let end = m[1] && m[2] ? Number(m[2]) : st.size - 1
      start = Math.max(0, start)
      end = Math.min(end, st.size - 1)
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}`, 'Cache-Control': privateCache } })
      headers.set('Content-Range', `bytes ${start}-${end}/${st.size}`)
      headers.set('Content-Length', String(end - start + 1))
      return new Response(req.method === 'HEAD' ? null : Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers })
    }
    headers.set('Content-Length', String(st.size))
    if (req.method === 'HEAD') return new Response(null, { headers })
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers })
  }

  async removePrefix(prefix: string) {
    await rm(this.path(prefix), { recursive: true, force: true })
  }

  async remove(key: string) {
    await rm(this.path(key), { force: true })
  }

  async putBuffer(key: string, data: Buffer) {
    const file = this.path(key)
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.part`
    await writeFile(tmp, data)
    await rename(tmp, file)
  }

  async getBuffer(key: string) {
    try {
      return await readFile(this.path(key))
    } catch {
      return null
    }
  }

  async readableUrl(key: string) {
    return this.path(key)
  }

  /* multipart: parts are files next to the original (<original>.parts/00001), joined on completion */
  private partsDir(key: string) {
    return `${this.path(key)}.parts`
  }

  async multipartStart(key: string) {
    await mkdir(this.partsDir(key), { recursive: true })
    return 'local'
  }

  async partTarget(_key: string, _uploadId: string, n: number, assetId: string): Promise<UploadTarget> {
    return { url: `/api/uploads/${assetId}/parts/${n}`, method: 'PUT', headers: {} }
  }

  /** used by the upload route: one part, refused unless it is exactly `expected` bytes */
  async writePart(key: string, n: number, body: ReadableStream<Uint8Array>, expected: number) {
    const dir = this.partsDir(key)
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, String(n).padStart(5, '0'))
    const tmp = `${file}.${randomUUID()}.part`
    let size = 0
    const counter = async function* (src: AsyncIterable<Uint8Array>) {
      for await (const chunk of src) {
        size += chunk.length
        if (size > expected) throw new Error('UPLOAD_TOO_LARGE')
        yield chunk
      }
    }
    try {
      await pipeline(Readable.fromWeb(body as never), counter, createWriteStream(tmp))
      if (size !== expected) throw new Error('PART_SHORT')
      await rename(tmp, file)
      return size
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }
  }

  async listParts(key: string) {
    const dir = this.partsDir(key)
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const parts: StoredPart[] = []
    for (const name of names) {
      if (!/^\d{5}$/.test(name)) continue // skip half-written temp files
      parts.push({ number: Number(name), size: (await stat(path.join(dir, name))).size, etag: name })
    }
    return parts.sort((a, b) => a.number - b.number)
  }

  async multipartComplete(key: string, _uploadId: string, parts: StoredPart[]) {
    const file = this.path(key)
    const tmp = `${file}.joining`
    const out = createWriteStream(tmp)
    try {
      for (const p of parts) {
        await pipeline(createReadStream(path.join(this.partsDir(key), String(p.number).padStart(5, '0'))), out, { end: false })
      }
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
      await rename(tmp, file)
    } catch (e) {
      out.destroy()
      await rm(tmp, { force: true })
      throw e
    }
    await rm(this.partsDir(key), { recursive: true, force: true })
  }

  async multipartAbort(key: string) {
    await rm(this.partsDir(key), { recursive: true, force: true })
  }
}

/* ------------------------------------------------ S3-compatible bucket */
class S3Storage implements Storage {
  kind = 's3' as const
  private aws: AwsClient
  private endpoint: string
  private bucket: string
  constructor(endpoint: string, bucket: string, region: string, accessKeyId: string, secretAccessKey: string, sessionToken?: string) {
    this.endpoint = endpoint
    this.bucket = bucket
    this.aws = new AwsClient({ accessKeyId, secretAccessKey, sessionToken, service: 's3', region })
  }

  private url(key: string) {
    assertKey(key)
    return `${this.endpoint}/${this.bucket}/${key}`
  }

  private async presign(key: string, method: 'GET' | 'HEAD' | 'PUT', expires: number, query: Record<string, string> = {}, signedAt?: Date, headers?: Record<string, string>) {
    const u = new URL(this.url(key))
    u.searchParams.set('X-Amz-Expires', String(expires))
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
    const datetime = signedAt?.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const signed = await this.aws.sign(u.toString(), { method, headers, aws: { signQuery: true, datetime, allHeaders: !!headers } })
    return signed.url
  }

  async uploadTarget(key: string, _assetId: string, bytes: number): Promise<UploadTarget> {
    const headers = { 'If-None-Match': '*' }
    const signed = { ...headers, 'Content-Length': String(bytes) }
    return { url: await this.presign(key, 'PUT', 6 * 3600, {}, undefined, signed), method: 'PUT', headers }
  }

  async size(key: string) {
    const res = await this.aws.fetch(this.url(key), { method: 'HEAD' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Storage HEAD failed (${res.status})`)
    return Number(res.headers.get('content-length') ?? 0)
  }

  async localCopy(key: string, scratch: string) {
    const file = path.join(scratch, `source${path.extname(key)}`)
    const res = await this.aws.fetch(this.url(key))
    if (!res.ok || !res.body) throw new Error(`Couldn’t download the original from storage (${res.status})`)
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file))
    return file
  }

  async outputDir(prefix: string, scratch: string) {
    const dir = path.join(scratch, 'out')
    await mkdir(dir, { recursive: true })
    const publish = async () => {
      const files: string[] = []
      for await (const f of walk(dir)) files.push(f)
      // a few at a time; HLS segments are a few MB each
      for (let i = 0; i < files.length; i += 6) {
        await Promise.all(
          files.slice(i, i + 6).map(async (f) => {
            const key = `${prefix}/${path.relative(dir, f).split(path.sep).join('/')}`
            const res = await this.aws.fetch(this.url(key), { method: 'PUT', body: await readFile(f), headers: { 'Content-Type': contentType(key) } })
            if (!res.ok) throw new Error(`Couldn’t upload ${key} to storage (${res.status})`)
          }),
        )
      }
    }
    return { dir, publish }
  }

  async serve(key: string, req: Request, opts: ServeOptions) {
    const { access } = opts
    if (grantExpired(access)) return unavailable()
    // A member's session has no transferable playback grant. Serve through the authorized
    // route so new requests for files and relative HLS children continue to require membership.
    if (access === 'member') {
      const headers = new Headers()
      const range = req.headers.get('range')
      if (range) headers.set('range', range)
      const response = await this.aws.fetch(this.url(key), { method: req.method, headers, signal: req.signal })
      if (!response.ok && response.status !== 416) {
        await response.body?.cancel()
        return new Response(null, { status: response.status === 404 ? 404 : 502, headers: { 'Cache-Control': privateCache } })
      }
      const outward = new Headers({ 'Content-Type': contentType(key), 'Cache-Control': privateCache })
      for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const value = response.headers.get(name)
        if (value !== null) outward.set(name, value)
      }
      if (opts.download) outward.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`)
      return new Response(response.body, { status: response.status, headers: outward })
    }
    let playlist: string | undefined
    if (key.endsWith('.m3u8')) {
      // Playlists come through the app, with every segment rewritten to a signed bucket URL. Players then fetch
      // segments straight from the bucket with no redirects (Chrome's built-in HLS player won't follow a segment
      // redirect to another origin). Nested playlists stay relative, so they come back here and get signed too.
      const res = await this.aws.fetch(this.url(key))
      if (!res.ok) {
        await res.body?.cancel()
        return new Response(null, { status: res.status === 404 ? 404 : 502, headers: { 'Cache-Control': privateCache } })
      }
      playlist = await res.text()
    }
    // Use the same timestamp for calculating the remaining grant and for AWS SigV4.
    const signedAt = new Date()
    const remaining = access === 'public' ? Infinity : access.expiresAt - Math.floor(signedAt.getTime() / 1000)
    if (remaining <= 0) return unavailable()
    const query: Record<string, string> = access === 'public' ? {} : { 'response-cache-control': privateCache }
    if (opts.download) query['response-content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`
    if (playlist !== undefined) {
      const signChild = (child: string) => this.presign(child, 'GET', Math.min(6 * 3600, remaining), query, signedAt)
      const dir = key.slice(0, key.lastIndexOf('/') + 1)
      const lines = await Promise.all(
        playlist.split('\n').map(async (line) => {
          const uri = line.trim()
          // fMP4 ladders name their init segment in a tag
          const map = /^#EXT-X-MAP:URI="([^"]+)"/.exec(uri)
          if (map && !/^[a-z]+:/i.test(map[1])) return line.replace(map[1], await signChild(dir + map[1]))
          if (!uri || uri.startsWith('#') || uri.endsWith('.m3u8') || /^[a-z]+:/i.test(uri)) return line
          return signChild(dir + uri)
        }),
      )
      return new Response(req.method === 'HEAD' ? null : lines.join('\n'), { headers: { 'Content-Type': contentType(key), 'Cache-Control': access === 'public' ? 'private, no-cache' : privateCache } })
    }
    const url = await this.presign(key, req.method === 'HEAD' ? 'HEAD' : 'GET', Math.min(3600, remaining), query, signedAt)
    return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': access === 'public' ? 'private, max-age=600' : privateCache } })
  }

  async putBuffer(key: string, data: Buffer, type: string) {
    const res = await this.aws.fetch(this.url(key), { method: 'PUT', body: new Uint8Array(data), headers: { 'Content-Type': type } })
    if (!res.ok) throw new Error(`Couldn’t store ${key} (${res.status})`)
  }

  async getBuffer(key: string) {
    const res = await this.aws.fetch(this.url(key))
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Couldn’t read ${key} from storage (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
  }

  async readableUrl(key: string) {
    return this.presign(key, 'GET', 3600)
  }

  /* multipart: the bucket's own multipart upload. Browsers PUT parts straight to presigned URLs; the server lists
     what arrived (so browsers never need to read ETags, which buckets hide from CORS by default) and completes it. */
  async multipartStart(key: string) {
    const res = await this.aws.fetch(`${this.url(key)}?uploads`, { method: 'POST', headers: { 'Content-Type': contentType(key) } })
    const id = /<UploadId>([^<]+)<\/UploadId>/.exec(await res.text())?.[1]
    if (!res.ok || !id) throw new Error(`Couldn’t start a multipart upload (${res.status})`)
    return id
  }

  async partTarget(key: string, uploadId: string, n: number, _assetId: string, bytes: number): Promise<UploadTarget> {
    const signed = { 'Content-Length': String(bytes) }
    return { url: await this.presign(key, 'PUT', 24 * 3600, { partNumber: String(n), uploadId }, undefined, signed), method: 'PUT', headers: {} }
  }

  async listParts(key: string, uploadId: string) {
    const parts: StoredPart[] = []
    let marker = '0'
    for (let page = 0; page < 20; page++) {
      const res = await this.aws.fetch(`${this.url(key)}?uploadId=${encodeURIComponent(uploadId)}&part-number-marker=${marker}&max-parts=1000`)
      if (res.status === 404) return []
      if (!res.ok) throw new Error(`Couldn’t list uploaded parts (${res.status})`)
      const xml = await res.text()
      for (const m of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
        const get = (tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(m[1])?.[1] ?? ''
        parts.push({ number: Number(get('PartNumber')), size: Number(get('Size')), etag: get('ETag').replace(/&quot;/g, '"') })
      }
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break
      marker = /<NextPartNumberMarker>(\d+)<\/NextPartNumberMarker>/.exec(xml)?.[1] ?? marker
    }
    return parts.sort((a, b) => a.number - b.number)
  }

  async multipartComplete(key: string, uploadId: string, parts: StoredPart[], onlyIfMissing = false) {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const body = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.number}</PartNumber><ETag>${esc(p.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
    const headers: Record<string, string> = { 'Content-Type': 'application/xml' }
    if (onlyIfMissing) headers['If-None-Match'] = '*'
    const res = await this.aws.fetch(`${this.url(key)}?uploadId=${encodeURIComponent(uploadId)}`, { method: 'POST', body, headers })
    const text = await res.text()
    // a 200 can still carry an <Error> (the bucket failed while joining)
    if (!res.ok || /<Error>/.test(text)) throw new Error(`Couldn’t join the uploaded parts (${res.status}): ${/<Message>([^<]*)/.exec(text)?.[1] ?? 'unknown error'}`)
  }

  async multipartAbort(key: string, uploadId: string) {
    const res = await this.aws.fetch(`${this.url(key)}?uploadId=${encodeURIComponent(uploadId)}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) throw new Error(`Storage multipart abort failed (${res.status})`)
  }

  async remove(key: string) {
    const res = await this.aws.fetch(this.url(key), { method: 'DELETE' })
    if (!res.ok && res.status !== 404) throw new Error(`Couldn’t delete ${key} (${res.status})`)
  }

  async removePrefix(prefix: string) {
    assertKey(prefix)
    for (let round = 0; round < 200; round++) {
      const list = await this.aws.fetch(`${this.endpoint}/${this.bucket}?list-type=2&prefix=${encodeURIComponent(prefix + '/')}`)
      if (!list.ok) throw new Error(`Storage list failed (${list.status})`)
      const xml = await list.text()
      if (!/<ListBucketResult[\s/>]/.test(xml)) throw new Error('Invalid bucket deletion inventory.')
      const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, '&'))
      for (const key of keys) {
        assertKey(key)
        if (!key.startsWith(prefix + '/')) throw new Error('Bucket returned a key outside the requested deletion prefix.')
      }
      if (!keys.length) {
        if (/<IsTruncated>true<\/IsTruncated>/.test(xml)) throw new Error('Incomplete bucket deletion inventory.')
        return
      }
      for (let i = 0; i < keys.length; i += 10) {
        await Promise.all(keys.slice(i, i + 10).map((k) => this.remove(k)))
      }
    }
    throw new Error('Storage deletion batch limit reached. Retry to finish.')
  }

  /** Exact contents of an asset prefix, including subsequent S3 listing pages. */
  async migrationKeys(prefix: string) {
    assertKey(prefix)
    const keys: string[] = []
    let continuation = ''
    do {
      const url = new URL(`${this.endpoint}/${this.bucket}`)
      url.searchParams.set('list-type', '2')
      url.searchParams.set('prefix', prefix + '/')
      url.searchParams.set('encoding-type', 'url')
      if (continuation) url.searchParams.set('continuation-token', continuation)
      const res = await this.aws.fetch(url)
      if (!res.ok) throw new Error(`Storage inventory failed (${res.status})`)
      const xml = await res.text()
      if (!/<ListBucketResult[\s>]/.test(xml)) throw new Error('Invalid bucket inventory response.')
      for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
        const key = decodeURIComponent(match[1])
        assertKey(key)
        if (!key.startsWith(prefix + '/')) throw new Error('Unexpected key in bucket inventory.')
        keys.push(key)
      }
      const more = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1].replace(/&amp;/g, '&')
      if (more && (!next || next === continuation)) throw new Error('Incomplete bucket inventory.')
      continuation = more ? next! : ''
    } while (continuation)
    return keys
  }
}

const stores = new Map<Storage['kind'], Storage>()

// Identify assets written before per-asset routing exactly once, during migration.
export function legacyStorageKind(env = process.env): Storage['kind'] {
  if (env.MEDIAEX_LEGACY_STORAGE === 'local' || env.MEDIAEX_LEGACY_STORAGE === 's3') return env.MEDIAEX_LEGACY_STORAGE
  if (env.MEDIAEX_LEGACY_STORAGE) throw new Error('MEDIAEX_LEGACY_STORAGE must be local or s3.')
  if (env.MEDIAEX_S3_WORKSPACE_IDS !== undefined) return 'local'
  return env.S3_BUCKET && env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? 's3' : 'local'
}

export function newStorageKind(workspaceId: string, env = process.env): Storage['kind'] {
  if (env.MEDIAEX_S3_WORKSPACE_IDS === undefined) return legacyStorageKind(env)
  const enabled = env.MEDIAEX_S3_WORKSPACE_IDS.split(',').map(id => id.trim()).filter(Boolean)
  return enabled.includes(workspaceId) ? 's3' : 'local'
}

export function storage(asset?: { storageBackend: Storage['kind'] }): Storage {
  const kind = asset ? asset.storageBackend : legacyStorageKind()
  const existing = stores.get(kind)
  if (existing) return existing
  let store: Storage
  if (kind === 'local') {
    store = new LocalStorage(path.resolve(process.env.MEDIA_DIR || '.media'))
  } else if (kind === 's3') {
    const { S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_SESSION_TOKEN } = process.env
    if (!S3_BUCKET || !S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
      throw new Error('The S3 store for this asset is unavailable.')
    }
    store = new S3Storage(S3_ENDPOINT.replace(/\/+$/, ''), S3_BUCKET, S3_REGION || 'auto', S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_SESSION_TOKEN)
  } else {
    throw new Error('Unrecognized asset storage backend.')
  }
  stores.set(kind, store)
  return store
}

export function storageForWorkspace(workspaceId: string) {
  return storage({ storageBackend: newStorageKind(workspaceId) })
}

export const isLocal = (s: Storage): s is LocalStorage => s.kind === 'local'
export const isS3 = (s: Storage): s is S3Storage => s.kind === 's3'
export type { LocalStorage, S3Storage }
