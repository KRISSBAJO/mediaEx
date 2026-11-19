/**
 * The media pipeline worker. Runs inside the app's Node process (started from instrumentation.ts), takes queued
 * assets from Postgres one at a time and turns each original into streamable outputs with FFmpeg:
 *
 *   Analyse  ffprobe: what is it, how long, how big; plus a thumbnail (a frame, or a waveform for audio)
 *   Encode   video → H.264/AAC HLS ladder (1080p…360p, never above the source); audio → AAC HLS; image → poster
 *   Package  master playlist, sizes, publish to storage
 *
 * Jobs are claimed with `for update skip locked`, so several app instances can share the queue safely.
 * Needs `ffmpeg` and `ffprobe` on PATH (or FFMPEG_PATH / FFPROBE_PATH).
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pool } from '../auth.mts'
import { prefixOf, type AssetRow } from './assets.mts'
import { reviewAsset } from './moderation.mts'
import { storage } from './storage.mts'
import type { MediaType, Rendition } from './types.mts'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'
const MAX_ATTEMPTS = 3

/* ------------------------------------------------ running FFmpeg */
function run(cmd: string, args: string[], onStdout?: (line: string) => void, cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, cwd })
    let out = ''
    let err = ''
    let buf = ''
    p.stdout.on('data', (d: Buffer) => {
      const s = d.toString()
      if (!onStdout) return void (out += s)
      buf += s
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      lines.forEach(onStdout)
    })
    p.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-8000) // keep the tail; that's where FFmpeg explains failures
    })
    p.on('error', (e: NodeJS.ErrnoException) =>
      reject(e.code === 'ENOENT' ? new Error(`${path.basename(cmd)} isn’t installed on the server. Install FFmpeg or set ${cmd === FFMPEG ? 'FFMPEG_PATH' : 'FFPROBE_PATH'}.`) : e),
    )
    p.on('close', (code) => {
      if (code === 0) resolve({ stdout: out, stderr: err })
      else reject(new FfmpegError(err))
    })
  })
}

class FfmpegError extends Error {
  constructor(stderr: string) {
    const lines = stderr
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^(frame=|size=|Press \[q\]|\s*Metadata|\s*Stream #|\s*Duration)/.test(l))
    super(lines.slice(-2).join(' — ') || 'FFmpeg stopped without saying why.')
  }
}

/* ------------------------------------------------ analyse */
type Probe = {
  format: { format_name?: string; duration?: string; bit_rate?: string }
  streams: {
    codec_type: string
    codec_name?: string
    profile?: string
    width?: number
    height?: number
    r_frame_rate?: string
    avg_frame_rate?: string
    sample_rate?: string
    channels?: number
    nb_frames?: string
    duration?: string
    disposition?: { attached_pic?: number }
    tags?: { rotate?: string }
    side_data_list?: { rotation?: number }[]
  }[]
}

const CODEC_NAMES: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  prores: 'ProRes',
  mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2',
  dnxhd: 'DNxHD',
  aac: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  alac: 'ALAC',
  mjpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  gif: 'GIF',
  tiff: 'TIFF',
  bmp: 'BMP',
}
const codecName = (c?: string) => (c ? (CODEC_NAMES[c] ?? (c.startsWith('pcm_') ? 'PCM' : c.toUpperCase())) : 'Unknown')

function fps(rate?: string) {
  const [n, d] = (rate ?? '').split('/').map(Number)
  return n && d ? n / d : 0
}

function analyse(p: Probe, guessed: MediaType) {
  const video = p.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = p.streams.find((s) => s.codec_type === 'audio')
  const duration = Number(p.format.duration ?? video?.duration ?? audio?.duration ?? 0) || 0
  const still =
    !!video &&
    (/image2|_pipe$|^(png|jpeg|webp|tiff|bmp)_pipe/.test(p.format.format_name ?? '') || (['mjpeg', 'png', 'webp', 'tiff', 'bmp'].includes(video.codec_name ?? '') && (duration === 0 || video.nb_frames === '1')))

  let type: MediaType
  if (video && still && guessed !== 'video') type = 'image'
  else if (video) type = 'video'
  else if (audio) type = 'audio'
  else throw new Error('This file has no video, audio or image we can read.')

  let width = video?.width ?? null
  let height = video?.height ?? null
  const rotation = Math.abs(Number(video?.tags?.rotate ?? video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)) % 180
  if (rotation === 90 && width && height) [width, height] = [height, width] // phones record sideways and flag it

  const parts: string[] = []
  if (type === 'video' && video) {
    parts.push(`${codecName(video.codec_name)}${video.profile && video.codec_name === 'prores' ? ` ${video.profile}` : ''}`, `${width}×${height}`)
    const f = fps(video.avg_frame_rate) || fps(video.r_frame_rate)
    if (f) parts.push(`${Math.round(f * 100) / 100} fps`)
    if (audio) parts.push(codecName(audio.codec_name))
  } else if (type === 'audio' && audio) {
    parts.push(codecName(audio.codec_name))
    if (audio.sample_rate) parts.push(`${Number(audio.sample_rate) / 1000} kHz`)
    if (audio.channels) parts.push(audio.channels === 1 ? 'mono' : audio.channels === 2 ? 'stereo' : `${audio.channels} ch`)
  } else if (video) {
    parts.push(codecName(video.codec_name), `${width}×${height}`)
  }
  return { type, duration: type === 'image' ? 0 : duration, width, height, hasAudio: !!audio, sourceInfo: parts.join(' · ') }
}

/* ------------------------------------------------ encode */
// rungs are named by the short side, so vertical video gets the same ladder as landscape
const LADDER = [
  { short: 1080, kbps: 5000 },
  { short: 720, kbps: 2800 },
  { short: 480, kbps: 1400 },
  { short: 360, kbps: 800 },
]
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

function ladderFor(width: number, height: number) {
  const short = Math.min(width, height)
  const rungs = LADDER.filter((r) => r.short <= short)
  if (!rungs.length) rungs.push({ short: even(short), kbps: 600 })
  return rungs.map((r) => {
    const scale = r.short / short
    return { ...r, width: even(width * scale), height: even(height * scale) }
  })
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size
  }
  return total
}

/* ------------------------------------------------ job bookkeeping */
async function update(id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields)
  await pool.query(`update "asset" set ${keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ')}, "updatedAt" = now() where id = $1`, [id, ...keys.map((k) => fields[k])])
}

async function claim(): Promise<AssetRow | null> {
  const { rows } = await pool.query<AssetRow>(
    `update "asset" set status = 'processing', stage = 1, progress = 0, error = null, attempts = attempts + 1, "updatedAt" = now()
      where id = (select id from "asset" where status = 'queued' order by "createdAt" for update skip locked limit 1)
      returning *`,
  )
  return rows[0] ?? null
}

/** Jobs left "processing" by a server that stopped mid-way go back in the queue (or fail after a few tries). */
async function recoverStale() {
  await pool.query(
    `update "asset" set status = case when attempts >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end,
       error = case when attempts >= ${MAX_ATTEMPTS} then 'Processing was interrupted too many times.' else null end, "updatedAt" = now()
     where status = 'processing' and "updatedAt" < now() - interval '2 minutes'`,
  )
}

/* ------------------------------------------------ the pipeline */
async function processAsset(job: AssetRow) {
  const store = storage()
  const prefix = prefixOf(job)
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'mediaex-'))
  const t0 = Date.now()
  try {
    // 1 · Analyse
    const input = await store.localCopy(job.originalKey, scratch)
    const probe = JSON.parse((await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input])).stdout) as Probe
    const info = analyse(probe, job.type)
    await update(job.id, { type: info.type, duration: info.duration, width: info.width, height: info.height, sourceInfo: info.sourceInfo, progress: 4 })

    const { dir: out, publish } = await store.outputDir(prefix, scratch)
    // outputs of an earlier attempt are replaced, not mixed in
    await rm(path.join(out, 'hls'), { recursive: true, force: true })

    let thumbKey: string
    let posterKey: string | null = null
    if (info.type === 'audio') {
      await run(FFMPEG, ['-y', '-v', 'error', '-i', input, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1280x360:colors=#cfcdc8', '-frames:v', '1', path.join(out, 'thumb.png')])
      thumbKey = `${prefix}/thumb.png`
    } else {
      const at = info.type === 'video' ? Math.min(Math.max(info.duration * 0.1, 0), 3) : 0
      await run(FFMPEG, ['-y', '-v', 'error', ...(at ? ['-ss', String(at)] : []), '-i', input, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '4', path.join(out, 'thumb.jpg')])
      thumbKey = `${prefix}/thumb.jpg`
    }
    if (store.kind === 'local') await update(job.id, { thumbKey }) // lets the dashboard show the frame while encoding
    await update(job.id, { progress: 6, stage: 2 })

    // 2 · Encode
    const renditions: Rendition[] = []
    let playlistKey: string | null = null
    let lastWrite = 0
    const onProgress = (from: number, to: number) => (line: string) => {
      const m = /^out_time_us=(\d+)/.exec(line)
      if (!m || !info.duration) return
      const p = from + (to - from) * Math.min(1, Number(m[1]) / 1e6 / info.duration)
      if (Date.now() - lastWrite < 1000) return
      lastWrite = Date.now()
      void update(job.id, { progress: p })
    }

    if (info.type === 'video') {
      const rungs = ladderFor(info.width!, info.height!)
      const hls = path.join(out, 'hls')
      await mkdir(hls, { recursive: true })
      const split = `[0:v]split=${rungs.length}${rungs.map((_, i) => `[s${i}]`).join('')};` + rungs.map((r, i) => `[s${i}]scale=${r.width}:${r.height}:flags=bicubic,format=yuv420p[v${i}]`).join(';')
      const args = ['-y', '-v', 'error', '-i', input, '-filter_complex', split]
      rungs.forEach((r, i) => {
        args.push('-map', `[v${i}]`, `-c:v:${i}`, 'libx264', `-b:v:${i}`, `${r.kbps}k`, `-maxrate:v:${i}`, `${Math.round(r.kbps * 1.07)}k`, `-bufsize:v:${i}`, `${r.kbps * 1.5}k`)
        if (info.hasAudio) args.push('-map', '0:a:0')
      })
      args.push(
        '-preset', 'veryfast', '-profile:v', 'main', '-sc_threshold', '0', '-force_key_frames', 'expr:gte(t,n_forced*2)',
        ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : []),
        '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
        '-master_pl_name', 'master.m3u8',
        '-hls_segment_filename', 'v%v/seg_%03d.ts',
        '-var_stream_map', rungs.map((_, i) => (info.hasAudio ? `v:${i},a:${i}` : `v:${i}`)).join(' '),
        '-progress', 'pipe:1', '-nostats',
        'v%v/index.m3u8',
      )
      // run inside the output folder with relative, forward-slash paths so playlists never contain Windows separators
      await run(FFMPEG, args, onProgress(6, 94), hls)
      for (const [i, r] of rungs.entries()) {
        renditions.push({ name: `${r.short}p`, codec: info.hasAudio ? 'H.264 + AAC' : 'H.264', width: r.width, height: r.height, bitrate: r.kbps * 1000, size: await dirSize(path.join(hls, `v${i}`)) })
      }
      playlistKey = `${prefix}/hls/master.m3u8`
    } else if (info.type === 'audio') {
      const hls = path.join(out, 'hls', 'a')
      await mkdir(hls, { recursive: true })
      await run(
        FFMPEG,
        ['-y', '-v', 'error', '-i', input, '-vn', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
          '-hls_segment_filename', 'seg_%03d.ts', '-progress', 'pipe:1', '-nostats', 'index.m3u8'],
        onProgress(6, 94),
        hls,
      )
      renditions.push({ name: 'AAC 160 kbps', codec: 'AAC', bitrate: 160000, size: await dirSize(hls) })
      playlistKey = `${prefix}/hls/a/index.m3u8`
    } else {
      const poster = path.join(out, 'poster.jpg')
      await run(FFMPEG, ['-y', '-v', 'error', '-i', input, '-frames:v', '1', '-vf', "scale='min(2560,iw)':-2", '-q:v', '3', poster])
      const w = Math.min(2560, info.width ?? 2560)
      renditions.push({ name: 'Poster', codec: 'JPEG', width: w, height: info.width && info.height ? even((info.height * w) / info.width) : undefined, size: (await stat(poster)).size })
      posterKey = `${prefix}/poster.jpg`
    }
    const thumbFile = path.join(out, path.basename(thumbKey))
    renditions.push({ name: 'Thumbnail', codec: info.type === 'audio' ? 'PNG' : 'JPEG', width: info.type === 'audio' ? 1280 : Math.min(640, info.width ?? 640), size: (await stat(thumbFile)).size })

    // 3 · Package
    await update(job.id, { stage: 3, progress: 95 })
    const outputSize = await dirSize(out)
    await publish()
    await update(job.id, {
      status: 'ready', stage: 3, progress: 100, error: null, readyAt: new Date(),
      thumbKey, posterKey, playlistKey, renditions: JSON.stringify(renditions), outputSize,
    })
    // moderation: blocklist and optional automatic review decide whether it goes public
    await reviewAsset(job.id).catch((e) => console.error(`[media] ${job.id} moderation check failed:`, e instanceof Error ? e.message : e))
    console.log(`[media] ${job.id} ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (${info.type}, ${renditions.length} outputs)`)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[media] ${job.id} failed:`, message)
    await update(job.id, { status: 'failed', error: message.slice(0, 500) })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/* ------------------------------------------------ the loop */
type WorkerState = { busy: boolean; started: boolean; tick: () => Promise<void> }
declare global {
  var __mxWorker: WorkerState | undefined
}

/** Starts the worker once per process. Safe to call from anywhere. */
export function startWorker() {
  if (globalThis.__mxWorker?.started) return globalThis.__mxWorker
  const state: WorkerState = {
    busy: false,
    started: true,
    tick: async () => {
      if (state.busy) return
      state.busy = true
      try {
        await recoverStale()
        for (let job = await claim(); job; job = await claim()) await processAsset(job)
      } catch (e) {
        console.error('[media] worker error:', e instanceof Error ? e.message : e)
      } finally {
        state.busy = false
      }
    },
  }
  globalThis.__mxWorker = state
  setInterval(() => void state.tick(), 5000).unref()
  void state.tick()
  console.log('[media] pipeline worker started')
  return state
}

/** Wake the worker now instead of waiting for its next poll. */
export function kickWorker() {
  if (process.env.MEDIA_WORKER === 'off') return
  void startWorker().tick()
}
