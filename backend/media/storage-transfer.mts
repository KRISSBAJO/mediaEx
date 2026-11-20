/** Offline operator copy from the mounted media volume to its bound S3 bucket. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, lstat, realpath, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { contentType, SAFE_KEY, type Storage, type S3Storage, isS3 } from './storage.mts'
export type MigrationAsset = {
  id: string; organizationId: string; revisionId: string; storageBackend: 's3' | 'local'; status: string; deletedAt: Date | null
  versioned: boolean; captionPending: boolean; originalKey: string; size: string; mimeType: string | null
  required: string[]; fingerprint: string; receipt: string | null
}
type File = { key: string; file: string; size: number; sha256: string }
type Inventory = { prefix: string; files: File[]; bytes: number; digest: string }

export function eligible(asset: MigrationAsset, rollback: boolean) {
  if (asset.storageBackend !== (rollback ? 's3' : 'local')) return 'already on destination store'
  if (asset.deletedAt || asset.status !== 'ready' || asset.captionPending) return 'trashed, incomplete, or has active processing'
  if (asset.versioned || path.posix.dirname(asset.originalKey) !== asset.organizationId + '/' + asset.id) return 'has version history or a relocated original'
  if (rollback && !asset.receipt) return 'no active migration receipt for this revision'
  return null
}

async function hashStream(body: AsyncIterable<Uint8Array>) {
  const hash = createHash('sha256')
  for await (const data of body) hash.update(data)
  return hash.digest('hex')
}

function assertMediaKey(key: string) {
  if (!SAFE_KEY.test(key) || key.split('/').some(p => p === '.' || p === '..')) throw new Error('Unexpected key in asset inventory.')
}

/** The inventory includes every file, even cached transforms and all codec ladders. */
export async function localInventory(root: string, asset: MigrationAsset): Promise<Inventory> {
  const prefix = asset.organizationId + '/' + asset.id
  assertMediaKey(prefix)
  const rootPath = await realpath(root)
  const assetPath = path.join(rootPath, ...prefix.split('/'))
  if (await realpath(assetPath) !== assetPath) throw new Error('Asset directory traverses a symbolic link.')
  const files: File[] = []
  async function visit(dir: string, keyPrefix: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const key = keyPrefix + '/' + entry.name
      assertMediaKey(key)
      if (/\.(part|parts|joining)$/.test(entry.name)) throw new Error('An incomplete file remains in the asset directory.')
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(file, key)
      else if (entry.isFile()) files.push({ file, key, size: (await lstat(file)).size, sha256: await hashStream(createReadStream(file)) })
      else throw new Error('Asset contains a symbolic link or special file.')
    }
  }
  await visit(assetPath, prefix)
  const byKey = new Map(files.map(file => [file.key, file]))
  if (byKey.get(asset.originalKey)?.size !== Number(asset.size)) throw new Error('Original is missing or differs from the database size.')
  for (const key of asset.required) if (!byKey.has(key)) throw new Error('A referenced rendition, caption or variant is missing.')
  for (const file of files.filter(file => file.key.endsWith('.m3u8'))) {
    const lines = (await readFile(file.file, 'utf8')).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    for (const line of lines) {
      const refs = line.startsWith('#') ? [...line.matchAll(/\bURI="([^"]+)"/g)].map(match => match[1]) : [line]
      for (const ref of refs) {
        assertMediaKey(prefix + '/' + ref)
        if (!byKey.has(path.posix.join(path.posix.dirname(file.key), ref))) throw new Error('A playlist references a missing media file.')
      }
    }
  }
  files.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const digest = createHash('sha256').update(JSON.stringify(files.map(f => [f.key, f.size, f.sha256]))).digest('hex')
  return { prefix, files, bytes: files.reduce((sum, f) => sum + f.size, 0), digest }
}

/** The presigned PUT carries no credentials in logs or in the migration receipt. */
async function putRange(url: string, file: File, offset: number, length: number, headers: Record<string, string>) {
  const stream = length ? createReadStream(file.file, { start: offset, end: offset + length - 1 }) : undefined
  try {
    const opts = { method: 'PUT', duplex: 'half', redirect: 'error' as const,
      headers: { ...headers, 'Content-Length': String(length) }, body: stream && Readable.toWeb(stream) as ReadableStream<Uint8Array> }
    const response = await fetch(url, opts)
    await response.body?.cancel()
    if (!response.ok) throw new Error('Conditional migration upload failed (HTTP ' + response.status + ').')
    return response.headers.get('etag')
  } finally {
    stream?.destroy()
  }
}

async function copyMissing(bucket: S3Storage, file: File, mime: string) {
  if (file.size <= 5 * 1024 ** 3) {
    const { url } = await bucket.uploadTarget(file.key, '', file.size)
    await putRange(url, file, 0, file.size, { 'Content-Type': mime, 'If-None-Match': '*' })
    return
  }
  const upload = await bucket.multipartStart(file.key)
  const partSize = Math.max(16 * 1024 ** 2, Math.ceil(file.size / 10000))
  const parts: { number: number; size: number; etag: string }[] = []
  try {
    for (let offset = 0; offset < file.size; offset += partSize) {
      const number = parts.length + 1
      const size = Math.min(partSize, file.size - offset)
      const { url } = await bucket.partTarget(file.key, upload, number, '', size)
      const etag = await putRange(url, file, offset, size, {})
      if (!etag) throw new Error('Multipart upload response omitted ETag.')
      parts.push({ number, size, etag })
    }
    await bucket.multipartComplete(file.key, upload, parts, true)
  } catch (error) {
    await bucket.multipartAbort(file.key, upload)
    throw error
  }
}

export async function verifyBucket(bucket: Storage, inventory: Inventory, asset: MigrationAsset, rollback: boolean) {
  if (!isS3(bucket)) throw new Error('A configured private S3 bucket is required.')
  const keys = new Set(await bucket.migrationKeys(inventory.prefix))
  const localKeys = new Set(inventory.files.map(file => file.key))
  for (const key of keys) if (!localKeys.has(key)) throw new Error('The bucket has additional objects. The storage pointer was left in place.')
  if (rollback && (asset.receipt !== inventory.digest || keys.size !== localKeys.size))
    throw new Error('The retained local inventory or bucket changed since migration. Rollback requires reconciliation.')
  for (const file of inventory.files) {
    if (!keys.has(file.key)) await copyMissing(bucket, file, file.key === asset.originalKey && asset.mimeType ? asset.mimeType : contentType(file.key))
    const response = await bucket.serve(file.key, new Request('https://media.invalid'), { access: 'member' })
    if (response.status !== 200 || !response.body || await hashStream(Readable.fromWeb(response.body as never)) !== file.sha256)
      throw new Error('SHA-256 verification failed for an object. The storage pointer was left in place.')
  }
  const finalKeys = await bucket.migrationKeys(inventory.prefix)
  if (finalKeys.length !== localKeys.size || finalKeys.some(key => !localKeys.has(key))) throw new Error('Bucket inventory changed during verification.')
}
