/** Media types shared by the server and the dashboard. No server imports here. */

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
}

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
