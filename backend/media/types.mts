/** Media types shared by the API and the dashboard (re-exported for the frontend by lib/media/types.ts). Keep this file free of imports. */

export type MediaType = 'video' | 'audio' | 'image'

export type UploadPolicy = {
  kinds: MediaType[]
  maxBytes: number | null
  review: boolean
  playback: 'signed' | 'public'
  maxShortSide: number | null
  maxSourceEdge: number | null
  maxDuration: number | null
}
export type UploadPreset = { id: string; name: string; folderId: string | null; isDefault: boolean; policy: UploadPolicy }
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
  playbackUrl: string | null // HLS playlist for video/audio (H.264 for video: plays everywhere)
  /** extra video ladders when the workspace has them on: HEVC and AV1 HLS playlists */
  playbackUrls: Partial<Record<ExtraCodec, string | null>>
  captions: CaptionTrack[]
  folderId: string | null
  collectionIds: string[]
  metadata: Record<string, unknown> // { fieldId: value }
  moderation: ModerationState
  moderationFlags: ModerationFlag[]
  moderationNote: string | null
  /** public: anyone with the link can watch; signed: viewers need a playback token (members never do) */
  playback: 'public' | 'signed'
  /** a site admin took this asset down (the reason); only they can restore it */
  takenDown: string | null
}

/* ------------------------------------------------ developer platform */
export const KEY_SCOPES = ['read', 'upload', 'full'] as const
export type KeyScope = (typeof KEY_SCOPES)[number]
export const KEY_SCOPE_LABEL: Record<KeyScope, string> = { read: 'Read only', upload: 'Upload', full: 'Full access' }
export type ApiKey = { id: string; name: string; scope: KeyScope; last4: string; createdAt: string; lastUsedAt: string | null; createdBy: string | null }

export const WEBHOOK_EVENTS = ['asset.ready', 'asset.failed', 'asset.deleted', 'asset.review_required', 'asset.approved', 'asset.rejected', 'asset.captions_ready'] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]
export const WEBHOOK_EVENT_HELP: Record<WebhookEvent, string> = {
  'asset.ready': 'An upload finished processing and can stream',
  'asset.failed': 'Processing failed',
  'asset.deleted': 'An asset was deleted',
  'asset.review_required': 'Moderation is holding an upload for review',
  'asset.approved': 'Someone approved an asset in review',
  'asset.rejected': 'Someone rejected an asset in review',
  'asset.captions_ready': 'Automatic captions finished for an asset',
}
export type WebhookEndpoint = {
  id: string
  url: string
  description: string | null
  events: WebhookEvent[]
  enabled: boolean
  failures: number
  createdAt: string
  stats: { total: number; succeeded: number; failed: number; pending: number }
}
export type WebhookDelivery = {
  id: string
  endpointId: string
  url: string
  event: string
  status: 'pending' | 'succeeded' | 'failed'
  attempts: number
  responseStatus: number | null
  durationMs: number | null
  error: string | null
  createdAt: string
  deliveredAt: string | null
  nextAttemptAt: string | null
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
export type WorkspaceAssetSummary = {
  total: number
  unfiled: number
  committedBytes: number
  uploaded: number
  active: number
  failed: number
  pending: number
  bytes: number
  video: number
  audio: number
  image: number
}

export type AssetPage = {
  assets: MediaAsset[]
  total: number
  bytes: number
  previous: string | null
  next: string | null
}

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

/* ------------------------------------------------ analytics (see analytics.mts) */
export type AnalyticsRange = '7d' | '30d' | '90d'
export type AnalyticsReport = {
  range: AnalyticsRange
  from: string
  to: string
  totals: {
    views: number
    uniqueViewers: number
    watchHours: number
    avgViewSeconds: number
    avgStartupMs: number | null
    rebufferRatio: number // 0–1
    bytesDelivered: number
    errorRate: number // 0–1
    completionRate: number // 0–1
  }
  /** change against the previous period of the same length, as a fraction (0.12 = +12%) */
  change: { views: number | null; uniqueViewers: number | null; watchHours: number | null; avgViewSeconds: number | null; avgStartupMs: number | null; rebufferRatio: number | null; bytesDelivered: number | null }
  daily: { date: string; views: number; watchHours: number; viewers: number }[]
  hours: { hour: number; views: number }[] // viewer's local hour
  retention: { position: number; share: number }[] // position and share in %
  countries: { country: string | null; views: number }[]
  devices: { device: string; share: number }[] // % of watch time
  sources: { referrer: string | null; views: number }[]
  topAssets: { id: string; title: string; type: string; views: number; watchHours: number; completionRate: number }[]
  quality: { country: string | null; views: number; avgStartupMs: number | null; rebufferRatio: number; errorRate: number }[]
}

/* ------------------------------------------------ encoding (see encoding.mts) */
export type ExtraCodec = 'hevc' | 'av1'
export type EncodingSettings = {
  extraCodecs: ExtraCodec[]
  /** what this server's FFmpeg can encode */
  available: Record<ExtraCodec, boolean>
  /** 'nvenc' or 'qsv' when a GPU encoder is configured and present */
  hardware: string | null
  av1Encoder: string | null
  /** transcribe new uploads automatically (needs OPENAI_API_KEY on the server) */
  autoCaptions: boolean
  captionsAvailable: boolean
}

/* ------------------------------------------------ captions (see captions.mts) */
export type CaptionTrack = {
  lang: string // "en", or "auto" while a transcription is running
  label: string
  source: 'auto' | 'upload'
  status: 'queued' | 'processing' | 'ready' | 'failed'
  error: string | null
  url: string | null // the .vtt, once ready
}

/* ------------------------------------------------ billing (see billing.mts) */
export type PlanId = 'creator' | 'pro' | 'studio'
export type BillingInterval = 'month' | 'year'
export type BillingState = {
  plan: PlanId
  planName: string
  interval: BillingInterval | null
  status: 'free' | 'active' | 'past_due' | 'canceled' | 'incomplete'
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  /** which provider takes payments on this server; null when billing isn't set up */
  provider: 'stripe' | 'paystack' | null
  /** a card on file with the active provider, so "Manage billing" can open */
  manageable: boolean
  usage: {
    storageBytes: number
    storageLimit: number
    /** Studio only: storage past the 10 TB included, billed as you go */
    storageOverage: number
    minutes: number
    minutesLimit: number | null
    periodStart: string
    periodEnd: string
  }
  prices: { plan: PlanId; interval: BillingInterval; amount: number; currency: string }[]
}

/** A retention rule moves matching media to Trash (30-day restore window) once it is old enough. See retention.mts. */
export type RetentionBasis = 'created' | 'unplayed'
export type RetentionDraft = {
  name: string
  enabled: boolean
  folderId: string | null
  includeSubfolders: boolean
  kinds: MediaType[]
  tag: string | null
  basis: RetentionBasis
  days: number
}
export type RetentionRule = RetentionDraft & {
  id: string
  lastRunAt: string | null
  lastMoved: number
  totalMoved: number
  createdAt: string
  updatedAt: string
}
export type RetentionPreview = { count: number; bytes: number; samples: { id: string; title: string; type: MediaType }[] }
export type RetentionEvent = { name: string; action: string; moved: number | null; actor: string | null; createdAt: string }
