/** Media types shared by the API and the dashboard (re-exported for the frontend by lib/media/types.ts). Keep this file free of imports. */

export type MediaType = 'video' | 'audio' | 'image'
export type MediaStatus = 'uploading' | 'queued' | 'processing' | 'ready' | 'failed'

/** Pipeline stages, in order. `asset.stage` is an index into this list. */
export const STAGES = ['Upload', 'Analyse', 'Encode', 'Package'] as const

export type Rendition = {
  name: string // "1080p", "AAC 128 kbps", "Poster"
  codec: string // "H.264", "AAC", "JPEG"
  width?: number
  height?: number
  bitrate?: number // bits per second
  size: number // bytes
}

export type MediaAsset = {
  id: string
  title: string
  type: MediaType
  status: MediaStatus
  stage: number
  progress: number // 0-100 across the whole pipeline
  error: string | null
  fileName: string
  size: number // original, bytes
  outputSize: number // everything the pipeline produced, bytes
  duration: number // seconds, 0 for images
  width: number | null
  height: number | null
  sourceInfo: string | null // "H.264 · 1920×1080 · 30 fps"
  renditions: Rendition[]
  tags: string[]
  createdAt: string // ISO
  readyAt: string | null
  createdBy: string | null // display name
  thumbUrl: string | null
  posterUrl: string | null
  playbackUrl: string | null // HLS playlist for video/audio
  folderId: string | null
  collectionIds: string[]
  metadata: Record<string, unknown> // { fieldId: value }
  moderation: ModerationState
  moderationFlags: ModerationFlag[]
  moderationNote: string | null
}

/* ------------------------------------------------ moderation */
export type ModerationState = 'approved' | 'pending' | 'rejected'
export type ModerationMode = 'off' | 'all' | 'flagged'
export type ModerationFlag = { source: 'blocklist' | 'ai' | 'system'; reason: string; categories?: string[] }
export type ModerationSettings = { mode: ModerationMode; blocklist: string[]; aiReview: boolean; aiAvailable: boolean }

/* ------------------------------------------------ custom metadata */
export const FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'select', 'multiselect'] as const
export type FieldType = (typeof FIELD_TYPES)[number]
export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: 'Text',
  longtext: 'Long text',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  multiselect: 'Multi-select',
}
export type MetadataField = { id: string; key: string; label: string; type: FieldType; options: string[]; required: boolean; help: string | null }

/* ------------------------------------------------ organisation */
export type Folder = { id: string; name: string; parentId: string | null; assetCount: number; createdAt: string }
export type Collection = { id: string; name: string; description: string | null; assetCount: number; coverUrl: string | null; updatedAt: string }
export type TagCount = { tag: string; count: number }

/* ------------------------------------------------ search
   One query shape for the Library URL, the API and saved searches. */
export type StatusFilter = 'ready' | 'active' | 'failed'
export type DateFilter = '1d' | '7d' | '30d' | '365d'
export type Sort = 'relevance' | 'new' | 'old' | 'name' | 'size' | 'long'
export type SearchQuery = {
  q?: string
  folder?: string // a folder id, or "root" for assets in no folder; absent = everywhere
  collection?: string
  type?: MediaType[]
  status?: StatusFilter[]
  tags?: string[] // every tag must match
  date?: DateFilter
  sort?: Sort
  meta?: Record<string, string> // { fieldId: option } from dropdown fields; URL form m.<fieldId>=<option>
}
export type SavedSearch = { id: string; name: string; query: SearchQuery; createdAt: string }

const TYPES: MediaType[] = ['video', 'audio', 'image']
const STATUSES: StatusFilter[] = ['ready', 'active', 'failed']
const DATES: DateFilter[] = ['1d', '7d', '30d', '365d']
const SORTS: Sort[] = ['relevance', 'new', 'old', 'name', 'size', 'long']
const list = (v: string | null) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : [])
const ID = /^[a-z]{3}_[a-z0-9]{4,24}$/

/** Reads a query from URL parameters, dropping anything unknown. */
export function parseQuery(p: URLSearchParams): SearchQuery {
  const q: SearchQuery = {}
  const text = p.get('q')?.trim().slice(0, 200)
  if (text) q.q = text
  const folder = p.get('folder')
  if (folder && (folder === 'root' || ID.test(folder))) q.folder = folder
  const collection = p.get('collection')
  if (collection && ID.test(collection)) q.collection = collection
  const type = list(p.get('type')).filter((t): t is MediaType => TYPES.includes(t as MediaType))
  if (type.length) q.type = [...new Set(type)]
  const status = list(p.get('status')).filter((t): t is StatusFilter => STATUSES.includes(t as StatusFilter))
  if (status.length) q.status = [...new Set(status)]
  const tags = list(p.get('tags')).map((t) => t.toLowerCase().slice(0, 32))
  if (tags.length) q.tags = [...new Set(tags)].slice(0, 10)
  const date = p.get('date')
  if (date && DATES.includes(date as DateFilter)) q.date = date as DateFilter
  const sort = p.get('sort')
  if (sort && SORTS.includes(sort as Sort)) q.sort = sort as Sort
  const meta: Record<string, string> = {}
  for (const [k, v] of p) if (/^m\.mdf_[a-z0-9]{4,24}$/.test(k) && v.trim()) meta[k.slice(2)] = v.trim().slice(0, 60)
  if (Object.keys(meta).length) q.meta = meta
  return q
}

/** Writes a query as URL parameters (stable order, empty values left out). */
export function queryParams(q: SearchQuery): URLSearchParams {
  const p = new URLSearchParams()
  if (q.q) p.set('q', q.q)
  if (q.folder) p.set('folder', q.folder)
  if (q.collection) p.set('collection', q.collection)
  if (q.type?.length) p.set('type', q.type.join(','))
  if (q.status?.length) p.set('status', q.status.join(','))
  if (q.tags?.length) p.set('tags', q.tags.join(','))
  if (q.date) p.set('date', q.date)
  if (q.sort) p.set('sort', q.sort)
  for (const [k, v] of Object.entries(q.meta ?? {})) p.set(`m.${k}`, v)
  return p
}

/** Is anything narrowing the results (beyond where you are and how it's sorted)? */
export const isFiltered = (q: SearchQuery) => Boolean(q.q || q.type?.length || q.status?.length || q.tags?.length || q.date || Object.keys(q.meta ?? {}).length)

export const normaliseTag = (t: string) => t.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32)

export const isActive = (a: Pick<MediaAsset, 'status'>) => a.status === 'uploading' || a.status === 'queued' || a.status === 'processing'

/** What the dashboard accepts, by file extension (browsers don't always know the MIME type of pro formats). */
export const ACCEPT_EXT = {
  video: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mxf', 'mts', 'm2ts', 'ts', 'wmv', 'flv', '3gp', 'mpg', 'mpeg', 'gif'],
  audio: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'aif', 'aiff', 'wma'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'bmp', 'heic', 'avif'],
} as const

export function guessType(fileName: string, mime?: string | null): MediaType | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (mime === 'image/gif' || ext === 'gif') return 'video'
  if (mime?.startsWith('video/')) return 'video'
  if (mime?.startsWith('audio/')) return 'audio'
  if (mime?.startsWith('image/')) return 'image'
  for (const t of ['video', 'audio', 'image'] as const) if ((ACCEPT_EXT[t] as readonly string[]).includes(ext)) return t
  return null
}

export const ACCEPT_ATTR = [
  'video/*',
  'audio/*',
  'image/*',
  ...Object.values(ACCEPT_EXT)
    .flat()
    .map((e) => `.${e}`),
].join(',')
