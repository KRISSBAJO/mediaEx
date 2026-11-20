/**
 * Which encoders the pipeline uses.
 *
 * - H.264 is always made: it plays everywhere.
 * - HEVC and AV1 are opt-in per workspace (Settings → Encoding). They're smaller for the same quality, so viewers
 *   whose devices can decode them use less data, but they take longer to encode on CPU: AV1 several times longer.
 *   They're packaged as separate HLS ladders (fMP4 segments); the MediaEX player picks the best one the device plays.
 * - GPU encoding: set MEDIA_HW_ENCODER=nvenc (NVIDIA) or qsv (Intel Quick Sync) on a server whose FFmpeg build has
 *   those encoders. Anything the GPU can't do, or a GPU encode that fails, falls back to the CPU encoder.
 *
 *   GET /api/encoding     the workspace's choice, and what this server can encode     members
 *   PUT /api/encoding     { extraCodecs: ['hevc', 'av1'] }                            owners and admins
 */
import { spawn } from 'node:child_process'
import { pool } from '../auth.mts'
import { HttpError, requireMember } from './assets.mts'
import type { EncodingSettings, ExtraCodec } from './types.mts'
import { captionsAvailable } from './captions.mts'

export const EXTRA_CODECS: ExtraCodec[] = ['hevc', 'av1']
type Codec = 'h264' | ExtraCodec
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'

let listed: Promise<Set<string>> | null = null
/** encoder names this FFmpeg build has (asked once per process) */
export function encoders(): Promise<Set<string>> {
  listed ??= new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-encoders'], { windowsHide: true })
    let out = ''
    p.stdout.on('data', (d: Buffer) => (out += d.toString()))
    p.on('error', () => resolve(new Set()))
    p.on('close', () => resolve(new Set([...out.matchAll(/^\s*[VAS][A-Z.]{5}\s+(\S+)/gm)].map((m) => m[1]))))
  })
  return listed
}

const hardware = () => {
  const v = (process.env.MEDIA_HW_ENCODER ?? '').toLowerCase()
  return v === 'nvenc' || v === 'qsv' ? v : null
}

const CPU: Record<Codec, string[]> = { h264: ['libx264'], hevc: ['libx265'], av1: ['libsvtav1', 'libaom-av1'] }

export type Encoder = { name: string; hw: boolean; args: string[]; pixFmt: string }

/** Encoder settings tuned for a VOD ladder: quick presets, Apple-compatible HEVC tagging. */
function settings(name: string): Encoder {
  const hw = /_(nvenc|qsv)$/.test(name)
  const pixFmt = name.endsWith('_qsv') ? 'nv12' : 'yuv420p'
  const args: Record<string, string[]> = {
    libx264: ['-preset', 'veryfast', '-profile:v', 'main'],
    h264_nvenc: ['-preset', 'p4', '-profile:v', 'main'],
    h264_qsv: ['-preset', 'veryfast', '-profile:v', 'main'],
    libx265: ['-preset', 'fast', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'],
    hevc_nvenc: ['-preset', 'p4', '-tag:v', 'hvc1'],
    hevc_qsv: ['-preset', 'veryfast', '-tag:v', 'hvc1'],
    libsvtav1: ['-preset', '8'],
    'libaom-av1': ['-cpu-used', '8', '-row-mt', '1', '-usage', 'realtime'],
    av1_nvenc: ['-preset', 'p4'],
    av1_qsv: ['-preset', 'veryfast'],
  }
  return { name, hw, args: args[name] ?? [], pixFmt }
}

/** The encoder for a codec: the GPU one when configured and present, else the CPU one; null when there's none. */
export async function encoderFor(codec: Codec, allowHw = true): Promise<Encoder | null> {
  const have = await encoders()
  const hw = hardware()
  if (allowHw && hw && have.has(`${codec}_${hw}`)) return settings(`${codec}_${hw}`)
  const cpu = CPU[codec].find((n) => have.has(n))
  return cpu ? settings(cpu) : null
}

async function available() {
  return { hevc: (await encoderFor('hevc')) !== null, av1: (await encoderFor('av1')) !== null }
}

/** The codecs a workspace wants beyond H.264 that this server can make. */
export async function extraCodecsFor(orgId: string): Promise<ExtraCodec[]> {
  const { rows } = await pool.query<{ extraCodecs: string[] | null }>('select "extraCodecs" from "workspace_setting" where "organizationId" = $1', [orgId])
  const want = (rows[0]?.extraCodecs ?? []).filter((c): c is ExtraCodec => (EXTRA_CODECS as string[]).includes(c))
  const can = await available()
  return want.filter((c) => can[c])
}

export async function getEncoding(orgId: string): Promise<EncodingSettings> {
  const { rows } = await pool.query<{ extraCodecs: string[] | null; autoCaptions: boolean }>('select "extraCodecs", "autoCaptions" from "workspace_setting" where "organizationId" = $1', [orgId])
  const can = await available()
  const hw = hardware()
  const have = await encoders()
  return {
    extraCodecs: (rows[0]?.extraCodecs ?? []).filter((c): c is ExtraCodec => (EXTRA_CODECS as string[]).includes(c)),
    available: can,
    hardware: hw && have.has(`h264_${hw}`) ? hw : null,
    av1Encoder: (await encoderFor('av1'))?.name ?? null,
    autoCaptions: rows[0]?.autoCaptions ?? false,
    captionsAvailable: captionsAvailable(),
  }
}

/** checked before saving a workspace's choice (billing adds plan limits through this hook) */
export const encodingGuards: ((orgId: string, codecs: ExtraCodec[]) => Promise<void>)[] = []

export async function handleEncoding(req: Request) {
  const m = await requireMember(req.headers)
  if (req.method === 'GET') return Response.json(await getEncoding(m.orgId), { headers: { 'Cache-Control': 'no-store' } })
  if (req.method !== 'PUT') throw new HttpError(405, 'Method not allowed')
  if (m.role !== 'owner' && m.role !== 'admin') throw new HttpError(403, 'Only owners and admins can change encoding.')
  const b = ((await req.json().catch(() => null)) ?? {}) as { extraCodecs?: unknown; autoCaptions?: unknown }
  const current = await getEncoding(m.orgId)
  if (b.extraCodecs !== undefined && (!Array.isArray(b.extraCodecs) || !b.extraCodecs.every((c) => (EXTRA_CODECS as unknown[]).includes(c)))) {
    throw new HttpError(400, `extraCodecs must be a list of: ${EXTRA_CODECS.join(', ')}.`)
  }
  if (b.autoCaptions !== undefined && typeof b.autoCaptions !== 'boolean') throw new HttpError(400, 'autoCaptions must be true or false.')
  const autoCaptions = (b.autoCaptions as boolean | undefined) ?? current.autoCaptions
  if (autoCaptions && !current.autoCaptions && !captionsAvailable()) throw new HttpError(400, 'Automatic captions need an OpenAI key on the server (OPENAI_API_KEY).')
  const codecs = [...new Set((b.extraCodecs as ExtraCodec[] | undefined) ?? current.extraCodecs)]
  const can = await available()
  const missing = codecs.filter((c) => !can[c])
  if (missing.length) throw new HttpError(400, `This server’s FFmpeg can’t encode ${missing.map((c) => c.toUpperCase()).join(' or ')}.`)
  for (const guard of encodingGuards) await guard(m.orgId, codecs)
  await pool.query(
    `insert into "workspace_setting" ("organizationId", "extraCodecs", "autoCaptions", "updatedAt") values ($1, $2, $3, now())
     on conflict ("organizationId") do update set "extraCodecs" = excluded."extraCodecs", "autoCaptions" = excluded."autoCaptions", "updatedAt" = now()`,
    [m.orgId, codecs, autoCaptions],
  )
  return Response.json(await getEncoding(m.orgId))
}
