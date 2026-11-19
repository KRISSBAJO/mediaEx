/**
 * On-the-fly image transformations, cached.
 *
 *   GET /api/media/:id/transform?w=640&h=360&fit=cover&pos=attention&f=auto&q=75
 *
 * Works on images, on a frame of a video (`t=` seconds) and on an audio asset's waveform. The first request for a
 * combination renders it with sharp (FFmpeg pulls the video frame) and stores the result next to the asset; every
 * later request is served from storage. Limits keep public URLs from being used to burn CPU: sizes are capped, each
 * asset keeps at most MAX_VARIANTS cached variants, and only a couple of renders run at once.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { pool } from '../auth.mts'
import { HttpError, getAssetRow, prefixOf, type AssetRow } from './assets.mts'
import { contentType, storage } from './storage.mts'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const MAX_SIDE = 4096
const MAX_PIXELS = 16_777_216 // 16 MP output
const MAX_VARIANTS = Number(process.env.MAX_VARIANTS_PER_ASSET || 200)
const RENDER_SLOTS = 2
const QUEUE_LIMIT = 24

export const FITS = ['cover', 'contain', 'fill', 'inside', 'outside'] as const
export const POSITIONS = ['center', 'top', 'bottom', 'left', 'right', 'attention', 'entropy'] as const
export const FORMATS = ['auto', 'webp', 'avif', 'jpeg', 'png'] as const
export const GRAVITY = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'] as const

type Fit = (typeof FITS)[number]
type Pos = (typeof POSITIONS)[number]
type Format = Exclude<(typeof FORMATS)[number], 'auto'>
type Gravity = (typeof GRAVITY)[number]

export type TransformParams = {
  w?: number
  h?: number
  fit: Fit
  pos: Pos
  f: Format
  q: number
  t?: number
  blur?: number
  gray?: boolean
  rot?: 90 | 180 | 270
  flip?: 'h' | 'v'
  wm?: string
  wm_text?: string
  wm_pos: Gravity
  wm_w: number
  wm_o: number
}

/* ------------------------------------------------ parameters: strict, so typos explain themselves */
const KNOWN = new Set(['w', 'h', 'dpr', 'fit', 'pos', 'f', 'q', 't', 'blur', 'gray', 'rot', 'flip', 'wm', 'wm_text', 'wm_pos', 'wm_w', 'wm_o'])

function num(p: URLSearchParams, k: string, min: number, max: number, int = true) {
  const raw = p.get(k)
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new HttpError(400, `${k} must be ${int ? 'a whole number' : 'a number'} from ${min} to ${max}.`)
  return n
}
function pick<T extends string>(p: URLSearchParams, k: string, allowed: readonly T[], fallback: T): T {
  const raw = p.get(k)
  if (raw === null || raw === '') return fallback
  if (!(allowed as readonly string[]).includes(raw)) throw new HttpError(400, `${k} must be one of: ${allowed.join(', ')}.`)
  return raw as T
}

/** Picks a format the browser can show: AVIF, then WebP, then JPEG (PNG when the source has transparency). */
export function negotiate(accept: string | null, hasAlpha: boolean): Format {
  const a = accept ?? ''
  if (a.includes('image/avif')) return 'avif'
  if (a.includes('image/webp')) return 'webp'
  return hasAlpha ? 'png' : 'jpeg'
}

export function parseTransform(p: URLSearchParams, accept: string | null, hasAlpha: boolean): TransformParams {
  for (const k of p.keys()) if (!KNOWN.has(k)) throw new HttpError(400, `Unknown parameter “${k}”. Use: ${[...KNOWN].join(', ')}.`)
  const dpr = num(p, 'dpr', 1, 3, false) ?? 1
  let w = num(p, 'w', 1, MAX_SIDE)
  let h = num(p, 'h', 1, MAX_SIDE)
  if (w) w = Math.min(MAX_SIDE, Math.round(w * dpr))
  if (h) h = Math.min(MAX_SIDE, Math.round(h * dpr))
  if (w && h && w * h > MAX_PIXELS) throw new HttpError(400, `That’s more than ${MAX_PIXELS / 1_048_576} megapixels. Ask for a smaller size.`)
  const fmt = pick(p, 'f', FORMATS, 'auto')
  const rot = num(p, 'rot', 0, 270)
  if (rot !== undefined && ![0, 90, 180, 270].includes(rot)) throw new HttpError(400, 'rot must be 90, 180 or 270.')
  const flip = p.get('flip')
  if (flip && flip !== 'h' && flip !== 'v') throw new HttpError(400, 'flip must be h or v.')
  const wm = p.get('wm') || undefined
  if (wm && !/^ast_[a-z0-9]{6,20}$/.test(wm)) throw new HttpError(400, 'wm must be the ID of an image asset in the same workspace.')
  const text = p.get('wm_text')?.trim().slice(0, 60) || undefined
  return {
    w,
    h,
    // one side given: scale to it; both: fill the box and crop
    fit: pick(p, 'fit', FITS, w && h ? 'cover' : 'inside'),
    pos: pick(p, 'pos', POSITIONS, 'center'),
    f: fmt === 'auto' ? negotiate(accept, hasAlpha) : fmt,
    q: num(p, 'q', 1, 100) ?? 80,
    t: num(p, 't', 0, 86_400, false),
    blur: num(p, 'blur', 1, 100, false),
    gray: p.get('gray') === '1' || p.get('gray') === 'true' || undefined,
    rot: rot ? (rot as 90 | 180 | 270) : undefined,
    flip: (flip as 'h' | 'v') || undefined,
    wm,
    wm_text: text,
    wm_pos: pick(p, 'wm_pos', GRAVITY, 'se'),
    wm_w: num(p, 'wm_w', 0.05, 1, false) ?? 0.2,
    wm_o: num(p, 'wm_o', 0, 1, false) ?? 0.7,
  }
}

/** Stable text for a parameter set: same request, same cache entry. */
function canonical(t: TransformParams) {
  return Object.entries(t)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

/* ------------------------------------------------ sources */
function ffmpegFrame(input: string, at: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-ss', String(at), '-i', input, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { windowsHide: true })
    const chunks: Buffer[] = []
    let err = ''
    p.stdout.on('data', (d: Buffer) => chunks.push(d))
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)))
    p.on('error', reject)
    p.on('close', (code) => {
      const out = Buffer.concat(chunks)
      if (code === 0 && out.length) resolve(out)
      else reject(new HttpError(422, at > 0 ? 'No frame at that time. Is t past the end of the video?' : `Couldn’t read a frame: ${err.split('\n').filter(Boolean).pop() ?? 'unknown error'}`))
    })
  })
}

async function sourceImage(a: AssetRow, t?: number): Promise<Buffer> {
  const store = storage()
  if (a.type === 'image') {
    const b = await store.getBuffer(a.originalKey)
    if (!b) throw new HttpError(404, 'The original is missing.')
    return b
  }
  if (a.type === 'video') {
    const at = t ?? Math.min(Math.max((a.duration || 0) * 0.1, 0), 3)
    if (a.duration && at > a.duration) throw new HttpError(400, `t is past the end of the video (${a.duration.toFixed(1)} s).`)
    return ffmpegFrame(await store.readableUrl(a.originalKey), at)
  }
  // audio: transform the waveform picture
  const b = a.thumbKey ? await store.getBuffer(a.thumbKey) : null
  if (!b) throw new HttpError(404, 'This audio asset has no waveform yet.')
  return b
}

/* ------------------------------------------------ rendering */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const SHARP_GRAVITY: Record<Gravity, string> = { nw: 'northwest', n: 'north', ne: 'northeast', w: 'west', c: 'centre', e: 'east', sw: 'southwest', s: 'south', se: 'southeast' }

async function render(src: Buffer, t: TransformParams, watermark: Buffer | null) {
  let img = sharp(src, { failOn: 'none', limitInputPixels: 268_402_689 }).rotate() // honour camera orientation
  if (t.rot) img = img.rotate(t.rot)
  if (t.flip === 'h') img = img.flop()
  if (t.flip === 'v') img = img.flip()
  // a crop keeps the shape you asked for: when the source is smaller than the box, shrink the box, not the aspect ratio
  let w = t.w
  let h = t.h
  if (w && h && (t.fit === 'cover' || t.fit === 'fill')) {
    const m = await sharp(src, { failOn: 'none' }).metadata()
    let sw = m.width ?? w
    let sh = m.height ?? h
    if ((m.orientation ?? 1) >= 5) [sw, sh] = [sh, sw]
    if (t.rot === 90 || t.rot === 270) [sw, sh] = [sh, sw]
    const k = Math.min(1, sw / w, sh / h)
    if (k < 1) {
      w = Math.max(1, Math.round(w * k))
      h = Math.max(1, Math.round(h * k))
    }
  }
  if (w || h) img = img.resize({ width: w, height: h, fit: t.fit, position: t.pos === 'attention' || t.pos === 'entropy' ? sharp.strategy[t.pos] : t.pos, withoutEnlargement: true })
  if (t.blur) img = img.blur(t.blur / 2)
  if (t.gray) img = img.grayscale()

  if (watermark || t.wm_text) {
    // settle the size first, then lay the watermark over it
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const width = info.width
    const height = info.height
    const margin = Math.round(Math.min(width, height) * 0.03)
    const markW = Math.max(16, Math.round(width * t.wm_w))
    let mark: Buffer
    if (watermark) {
      mark = await sharp(watermark).resize({ width: Math.min(markW, width - margin * 2), height: height - margin * 2, fit: 'inside' }).ensureAlpha().png().toBuffer()
    } else {
      const size = Math.max(10, Math.round(markW / Math.max(4, t.wm_text!.length * 0.55)))
      const svgW = Math.min(width - margin * 2, Math.round(size * t.wm_text!.length * 0.62) + size)
      const svgH = Math.round(size * 1.5)
      mark = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}"><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${size}" fill="#fff" stroke="#000" stroke-opacity="0.35" stroke-width="${Math.max(1, size / 18)}" paint-order="stroke">${esc(t.wm_text!)}</text></svg>`,
      )
    }
    // fade by scaling the alpha channel
    const faded = await sharp(mark)
      .ensureAlpha()
      .composite([{ input: Buffer.from([255, 255, 255, Math.round(255 * t.wm_o)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
      .extend({ top: margin, bottom: margin, left: margin, right: margin, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    img = sharp(data, { raw: info }).composite([{ input: faded, gravity: SHARP_GRAVITY[t.wm_pos] }])
  }

  if (t.f === 'webp') img = img.webp({ quality: t.q })
  else if (t.f === 'avif') img = img.avif({ quality: Math.round(t.q * 0.75), effort: 4 })
  else if (t.f === 'png') img = img.png({ compressionLevel: 8 })
  else img = img.flatten({ background: '#ffffff' }).jpeg({ quality: t.q, mozjpeg: true })
  return img.toBuffer()
}

/* ------------------------------------------------ a small queue so public URLs can't pile up renders */
let active = 0
const waiting: (() => void)[] = []
const inflight = new Map<string, Promise<Buffer>>()

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= RENDER_SLOTS) {
    if (waiting.length >= QUEUE_LIMIT) throw new HttpError(503, 'Busy rendering other images. Try again in a moment.')
    await new Promise<void>((r) => waiting.push(r))
  }
  active++
  try {
    return await fn()
  } finally {
    active--
    waiting.shift()?.()
  }
}

/* ------------------------------------------------ the route */
/**
 * `preview=1` (members only) renders without storing anything, so the dashboard's builder can show every tweak
 * without filling the asset's variant allowance.
 */
export async function transform(req: Request, id: string, canView: (a: AssetRow) => Promise<boolean>, isMember: (a: AssetRow) => Promise<boolean>) {
  const a = await getAssetRow(id)
  if (!a || !(await canView(a))) return new Response('Not found', { status: 404 })
  if (a.status !== 'ready') throw new HttpError(409, 'This asset is still processing.')

  const url = new URL(req.url)
  const params = new URLSearchParams(url.searchParams)
  const preview = params.get('preview') === '1'
  params.delete('preview')
  if (preview && !(await isMember(a))) throw new HttpError(403, 'Previews are for members of the workspace.')
  const hasAlpha = a.type === 'image' && /\.(png|webp|avif|gif|tiff?)$/i.test(a.originalKey)
  const t = parseTransform(params, req.headers.get('accept'), hasAlpha)
  if (t.t !== undefined && a.type !== 'video') throw new HttpError(400, 't only applies to video.')

  // the watermark must be a ready image in the same workspace; its version is part of the cache key
  let wm: AssetRow | null = null
  if (t.wm) {
    wm = await getAssetRow(t.wm, a.organizationId)
    if (!wm || wm.type !== 'image' || wm.status !== 'ready') throw new HttpError(400, 'wm must be a ready image in the same workspace.')
  }

  if (preview) {
    const [src, mark] = await slot(() => Promise.all([sourceImage(a, t.t), wm ? storage().getBuffer(wm.originalKey) : Promise.resolve(null)]))
    const out = await slot(() => render(src, t, mark))
    return new Response(new Uint8Array(out), {
      headers: { 'Content-Type': contentType(`x.${t.f}`), 'Content-Length': String(out.length), 'Cache-Control': 'private, no-store', 'X-MediaEX-Cache': 'PREVIEW' },
    })
  }

  const version = `${new Date(a.readyAt ?? a.createdAt).getTime()}${wm ? `:${new Date(wm.readyAt ?? wm.createdAt).getTime()}` : ''}`
  const hash = createHash('sha256').update(`${canonical(t)}|${version}`).digest('hex').slice(0, 24)
  const key = `${prefixOf(a)}/derived/${hash}.${t.f === 'jpeg' ? 'jpg' : t.f}`
  const store = storage()

  let cache = 'HIT'
  if ((await store.size(key)) === null) {
    cache = 'MISS'
    const { rows } = await pool.query<{ n: number }>('select count(*)::int as n from "asset_variant" where "assetId" = $1', [a.id])
    if (rows[0].n >= MAX_VARIANTS) throw new HttpError(429, `This asset already has ${MAX_VARIANTS} cached variants. Reuse existing sizes, or re-run the pipeline to start fresh.`)
    let job = inflight.get(key)
    if (!job) {
      job = slot(async () => {
        const [src, mark] = await Promise.all([sourceImage(a, t.t), wm ? storage().getBuffer(wm.originalKey) : Promise.resolve(null)])
        const out = await render(src, t, mark)
        await store.putBuffer(key, out, contentType(key))
        await pool.query(
          `insert into "asset_variant" ("assetId", key, params, format, bytes) values ($1, $2, $3, $4, $5) on conflict ("assetId", key) do nothing`,
          [a.id, key, canonical(t), t.f, out.length],
        )
        return out
      }).finally(() => inflight.delete(key))
      inflight.set(key, job)
    }
    await job
  }

  const res = await store.serve(key, req)
  res.headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('X-MediaEX-Cache', cache)
  if (params.get('f') === 'auto' || !params.get('f')) res.headers.set('Vary', 'Accept')
  return res
}
