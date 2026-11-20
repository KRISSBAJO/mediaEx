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
/** a part already stored for a multipart upload */
export type StoredPart = { number: number; size: number; etag: string }

export interface Storage {
  kind: 'local' | 's3'
  /** where the browser PUTs the original file */
  uploadTarget(key: string, assetId: string): Promise<UploadTarget>
  /** size in bytes, or null when the object doesn't exist */
  size(key: string): Promise<number | null>
  /** a path on this machine the worker can read; downloads to `scratch` when the file isn't local */
  localCopy(key: string, scratch: string): Promise<string>
  /** directory the worker should write outputs into for `prefix`, and how to publish them afterwards */
  outputDir(prefix: string, scratch: string): Promise<{ dir: string; publish: () => Promise<void> }>
  /** answer a GET for a stored file (range requests supported) */
  serve(key: string, req: Request, opts?: { download?: string }): Promise<Response>
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
  partTarget(key: string, uploadId: string, n: number, assetId: string): Promise<UploadTarget>
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

  async serve(key: string, req: Request, opts: { download?: string } = {}) {
    const file = this.path(key)
    let st
    try {
      st = await stat(file)
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const headers = new Headers({
      'Content-Type': contentType(key),
      'Accept-Ranges': 'bytes',
      // playlists can change while an asset is re-processed; segments and images never change under the same name
      'Cache-Control': key.endsWith('.m3u8') ? 'no-cache' : 'private, max-age=3600',
    })
    if (opts.download) headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`)

    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '')
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : st.size - Number(m[2])
      let end = m[1] && m[2] ? Number(m[2]) : st.size - 1
      start = Math.max(0, start)
      end = Math.min(end, st.size - 1)
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } })
      headers.set('Content-Range', `bytes ${start}-${end}/${st.size}`)
      headers.set('Content-Length', String(end - start + 1))
      return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers })
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
    const tmp = `${file}.${process.pid}.${Date.now()}.part`
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
  constructor(endpoint: string, bucket: string, region: string, accessKeyId: string, secretAccessKey: string) {
    this.endpoint = endpoint
    this.bucket = bucket
    this.aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region })
  }

  private url(key: string) {
    assertKey(key)
    return `${this.endpoint}/${this.bucket}/${key}`
  }

  private async presign(key: string, method: 'GET' | 'PUT', expires: number, query: Record<string, string> = {}) {
    const u = new URL(this.url(key))
    u.searchParams.set('X-Amz-Expires', String(expires))
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
    const signed = await this.aws.sign(u.toString(), { method, aws: { signQuery: true } })
    return signed.url
  }

  async uploadTarget(key: string): Promise<UploadTarget> {
    return { url: await this.presign(key, 'PUT', 6 * 3600), method: 'PUT', headers: {} }
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

  async serve(key: string, req: Request, opts: { download?: string } = {}) {
    if (key.endsWith('.m3u8')) {
      // Playlists come through the app, with every segment rewritten to a signed bucket URL. Players then fetch
      // segments straight from the bucket with no redirects (Chrome's built-in HLS player won't follow a segment
      // redirect to another origin). Nested playlists stay relative, so they come back here and get signed too.
      const res = await this.aws.fetch(this.url(key))
      if (!res.ok) return new Response('Not found', { status: res.status === 404 ? 404 : 502 })
      const dir = key.slice(0, key.lastIndexOf('/') + 1)
      const lines = await Promise.all(
        (await res.text()).split('\n').map(async (line) => {
          const uri = line.trim()
          // fMP4 ladders name their init segment in a tag
          const map = /^#EXT-X-MAP:URI="([^"]+)"/.exec(uri)
          if (map && !/^[a-z]+:/i.test(map[1])) return line.replace(map[1], await this.presign(dir + map[1], 'GET', 6 * 3600))
          if (!uri || uri.startsWith('#') || uri.endsWith('.m3u8') || /^[a-z]+:/i.test(uri)) return line
          return this.presign(dir + uri, 'GET', 6 * 3600)
        }),
      )
      return new Response(lines.join('\n'), { headers: { 'Content-Type': contentType(key), 'Cache-Control': 'private, no-cache' } })
    }
    const query: Record<string, string> = opts.download ? { 'response-content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}` } : {}
    return new Response(null, { status: 302, headers: { Location: await this.presign(key, 'GET', 3600, query), 'Cache-Control': 'private, max-age=600' } })
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

  async partTarget(key: string, uploadId: string, n: number): Promise<UploadTarget> {
    return { url: await this.presign(key, 'PUT', 24 * 3600, { partNumber: String(n), uploadId }), method: 'PUT', headers: {} }
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

  async multipartComplete(key: string, uploadId: string, parts: StoredPart[]) {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const body = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.number}</PartNumber><ETag>${esc(p.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
    const res = await this.aws.fetch(`${this.url(key)}?uploadId=${encodeURIComponent(uploadId)}`, { method: 'POST', body, headers: { 'Content-Type': 'application/xml' } })
    const text = await res.text()
    // a 200 can still carry an <Error> (the bucket failed while joining)
    if (!res.ok || /<Error>/.test(text)) throw new Error(`Couldn’t join the uploaded parts (${res.status}): ${/<Message>([^<]*)/.exec(text)?.[1] ?? 'unknown error'}`)
  }

  async multipartAbort(key: string, uploadId: string) {
    await this.aws.fetch(`${this.url(key)}?uploadId=${encodeURIComponent(uploadId)}`, { method: 'DELETE' }).catch(() => {})
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
      const keys = [...(await list.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, '&'))
      if (!keys.length) return
      for (let i = 0; i < keys.length; i += 10) {
        await Promise.all(keys.slice(i, i + 10).map((k) => this.aws.fetch(this.url(k), { method: 'DELETE' })))
      }
    }
  }
}

/* ------------------------------------------------ pick one */
declare global {
  var __mxStorage: Storage | undefined
}

export function storage(): Storage {
  if (globalThis.__mxStorage) return globalThis.__mxStorage
  const { S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env
  globalThis.__mxStorage =
    S3_BUCKET && S3_ENDPOINT && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
      ? new S3Storage(S3_ENDPOINT.replace(/\/+$/, ''), S3_BUCKET, S3_REGION || 'auto', S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)
      : new LocalStorage(path.resolve(process.env.MEDIA_DIR || '.media'))
  return globalThis.__mxStorage
}

export const isLocal = (s: Storage): s is LocalStorage => s.kind === 'local'
export type { LocalStorage }
