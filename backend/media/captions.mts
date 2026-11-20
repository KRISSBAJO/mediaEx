/**
 * Captions: WebVTT tracks per asset, one per language.
 *
 * - Automatic: OpenAI's Whisper transcribes the audio (OPENAI_API_KEY on the backend; the workspace turns it on in
 *   Settings → Encoding, or asks per asset). The audio is cut to small mono chunks, sent to OpenAI, and the timed
 *   segments come back as one track in the language Whisper hears. Audio leaves our servers for this, which the
 *   setting says.
 * - Uploaded: a .vtt or .srt file in any language (SRT is converted).
 *
 *   GET    /api/assets/:id/captions                  the asset's tracks                       members
 *   POST   /api/assets/:id/captions/generate         transcribe now { language? }             members
 *   PUT    /api/assets/:id/captions/:lang            upload a track { label?, text }          members
 *   DELETE /api/assets/:id/captions/:lang                                                     members
 *   GET    /api/media/:id/captions/:lang.vtt         the track (same access as playback)
 *
 * Jobs live in Postgres (caption rows with status 'queued') and are claimed with `for update skip locked`.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { baseURL, pool } from '../auth.mts'
import { HttpError, getAssetRow, prefixOf, type AssetRow } from './assets.mts'
import { storage } from './storage.mts'
import { emitAsset } from './webhooks.mts'
import type { CaptionTrack } from './types.mts'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1'
// OPENAI_BASE_URL points at a compatible endpoint (a proxy, or a stand-in for tests)
const CHUNK_SECONDS = 600 // 10 minutes of 32 kbps mono ≈ 2.4 MB, well under the 25 MB request limit
const MAX_ATTEMPTS = 3
const LANG = /^[a-z]{2,3}(-[A-Z]{2})?$/

export const captionsAvailable = () => Boolean(process.env.OPENAI_API_KEY)

const names = new Intl.DisplayNames(['en'], { type: 'language' })
export const languageLabel = (lang: string) => {
  try {
    return names.of(lang) ?? lang
  } catch {
    return lang
  }
}

// Whisper answers with English language names; these are the ones it knows
const WHISPER: Record<string, string> = {
  english: 'en', french: 'fr', spanish: 'es', german: 'de', portuguese: 'pt', italian: 'it', dutch: 'nl', russian: 'ru', ukrainian: 'uk',
  polish: 'pl', czech: 'cs', slovak: 'sk', romanian: 'ro', hungarian: 'hu', greek: 'el', turkish: 'tr', arabic: 'ar', hebrew: 'he', persian: 'fa',
  urdu: 'ur', hindi: 'hi', bengali: 'bn', tamil: 'ta', telugu: 'te', marathi: 'mr', gujarati: 'gu', kannada: 'kn', malayalam: 'ml', punjabi: 'pa',
  chinese: 'zh', japanese: 'ja', korean: 'ko', vietnamese: 'vi', thai: 'th', indonesian: 'id', malay: 'ms', tagalog: 'tl', swahili: 'sw',
  yoruba: 'yo', hausa: 'ha', afrikaans: 'af', amharic: 'am', somali: 'so', swedish: 'sv', norwegian: 'no', danish: 'da', finnish: 'fi',
  icelandic: 'is', catalan: 'ca', galician: 'gl', basque: 'eu', welsh: 'cy', irish: 'ga', serbian: 'sr', croatian: 'hr', bosnian: 'bs',
  slovenian: 'sl', bulgarian: 'bg', macedonian: 'mk', lithuanian: 'lt', latvian: 'lv', estonian: 'et', azerbaijani: 'az', kazakh: 'kk',
  uzbek: 'uz', armenian: 'hy', georgian: 'ka', nepali: 'ne', sinhala: 'si', khmer: 'km', lao: 'lo', burmese: 'my', mongolian: 'mn',
  maori: 'mi', haitian: 'ht', 'haitian creole': 'ht', lingala: 'ln', shona: 'sn', yiddish: 'yi', latin: 'la', belarusian: 'be',
}

/* ------------------------------------------------ WebVTT */
const stamp = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const sec = Math.floor((ms % 60_000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

export function toVtt(cues: { start: number; end: number; text: string }[]) {
  return `WEBVTT\n\n${cues
    .filter((c) => c.text.trim())
    .map((c) => `${stamp(c.start)} --> ${stamp(Math.max(c.end, c.start + 0.3))}\n${c.text.trim().replace(/-->/g, '→')}`)
    .join('\n\n')}\n`
}

/** Accepts WebVTT or SRT and returns WebVTT, or throws when it's neither. */
export function normaliseCaptions(text: string) {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
  if (!/-->/.test(t)) throw new HttpError(400, 'That doesn’t look like a caption file: there are no “-->” timings in it.')
  if (/^WEBVTT/.test(t)) return `${t}\n`
  // SRT: commas in timings become dots, and the header goes on
  return `WEBVTT\n\n${t.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}\n`
}

/* ------------------------------------------------ rows */
type CaptionRow = { assetId: string; lang: string; label: string; source: 'auto' | 'upload'; status: 'queued' | 'processing' | 'ready' | 'failed'; error: string | null; key: string | null; attempts: number; updatedAt: Date }

export async function listCaptions(assetId: string, db: Pick<typeof pool, 'query'> = pool): Promise<CaptionTrack[]> {
  const { rows } = await db.query<CaptionRow>('select * from "caption" where "assetId" = $1 order by source, label', [assetId])
  return rows.map((r) => ({ lang: r.lang, label: r.label, source: r.source, status: r.status, error: r.error, url: r.status === 'ready' ? `/api/media/${assetId}/captions/${r.lang}.vtt` : null }))
}

/** Queue an automatic transcription. `language` hints Whisper; otherwise it detects the language. */
export async function queueCaptions(asset: Pick<AssetRow, 'id' | 'type' | 'originalKey'>, language?: string, db: Pick<typeof pool,'query'> = pool) {
  if (asset.type === 'image') return
  // the placeholder row is keyed "auto" until Whisper says which language it heard
  await db.query(
    `insert into "caption" ("assetId", lang, label, source, status, hint)
     select id, 'auto', 'Transcribing…', 'auto', 'queued', $2 from (select id from asset where id=$1 and "originalKey"=$3 and "deletedAt" is null for share) active
     on conflict ("assetId", lang) do update set status = 'queued', error = null, attempts = 0, hint = excluded.hint, "updatedAt" = now()`,
    [asset.id, language ?? null, asset.originalKey],
  )
  kickCaptioner()
}

/** After an upload is ready: transcribe it when the workspace has automatic captions on. */
export async function captionsAfterReady(asset: AssetRow) {
  if (!captionsAvailable() || asset.type === 'image') return
  const { rows } = await pool.query<{ autoCaptions: boolean }>('select "autoCaptions" from "workspace_setting" where "organizationId" = $1', [asset.organizationId])
  if (rows[0]?.autoCaptions) await queueCaptions(asset)
}

/* ------------------------------------------------ transcribing */
function run(args: string[], cwd?: string) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(FFMPEG, args, { windowsHide: true, cwd })
    let err = ''
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || 'FFmpeg failed'))))
  })
}

type Segment = { start: number; end: number; text: string }

async function transcribe(file: string, hint: string | null): Promise<{ language: string | null; segments: Segment[] }> {
  const form = new FormData()
  form.append('file', new Blob([await readFile(file)], { type: 'audio/mp4' }), path.basename(file))
  form.append('model', MODEL)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  if (hint) form.append('language', hint.slice(0, 2))
  const res = await fetch(`${(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(10 * 60_000),
  })
  const body = (await res.json().catch(() => ({}))) as { language?: string; segments?: Segment[]; error?: { message?: string } }
  if (!res.ok) {
    const e = new Error(`Transcription failed (${res.status}): ${body.error?.message ?? 'no details'}`)
    ;(e as Error & { retry?: boolean }).retry = res.status === 429 || res.status >= 500
    throw e
  }
  return { language: body.language ? (WHISPER[body.language.toLowerCase()] ?? (LANG.test(body.language) ? body.language : null)) : null, segments: body.segments ?? [] }
}

async function processCaption(asset: AssetRow, hint: string | null) {
  const store = storage(asset)
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'mediaex-cc-'))
  try {
    const input = await store.localCopy(asset.originalKey, scratch)
    // small mono chunks: what speech recognition needs, and each one fits a request
    await run(['-y', '-v', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '32k', '-f', 'segment', '-segment_time', String(CHUNK_SECONDS), '-reset_timestamps', '1', 'chunk_%03d.m4a'], scratch)
    const chunks = (await readdir(scratch)).filter((f) => /^chunk_\d{3}\.m4a$/.test(f)).sort()
    if (!chunks.length) throw new Error('This file has no audio to transcribe.')
    const cues: Segment[] = []
    let language: string | null = null
    for (const [i, chunk] of chunks.entries()) {
      const r = await transcribe(path.join(scratch, chunk), hint ?? language)
      language ??= r.language
      cues.push(...r.segments.map((s) => ({ start: s.start + i * CHUNK_SECONDS, end: s.end + i * CHUNK_SECONDS, text: s.text })))
    }
    const lang = language ?? hint ?? 'und'
    const key = `${prefixOf(asset)}/captions/${lang}.vtt`
    await store.putBuffer(key, Buffer.from(toVtt(cues)), 'text/vtt')
    // the placeholder becomes the real track (replacing an earlier automatic one in that language)
    await pool.query('delete from "caption" where "assetId" = $1 and lang = $2 and lang <> \'auto\'', [asset.id, lang])
    await pool.query(
      `update "caption" set lang = $2, label = $3, status = 'ready', key = $4, error = null, "updatedAt" = now() where "assetId" = $1 and lang = 'auto'`,
      [asset.id, lang, languageLabel(lang), key],
    )
    await emitAsset(asset.id, 'asset.captions_ready')
    console.log(`[captions] ${asset.id}: ${cues.length} cues in ${languageLabel(lang)}`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/* ------------------------------------------------ the queue */
type Captioner = { busy: boolean; started: boolean; tick: () => Promise<void> }
declare global {
  var __mxCaptioner: Captioner | undefined
}

export function startCaptioner() {
  if (globalThis.__mxCaptioner?.started) return globalThis.__mxCaptioner
  const state: Captioner = {
    busy: false,
    started: true,
    tick: async () => {
      if (state.busy || !captionsAvailable()) return
      state.busy = true
      try {
        // jobs left "processing" by a server that stopped go back in the queue
        await pool.query(`update "caption" set status = 'queued' where status = 'processing' and "updatedAt" < now() - interval '30 minutes'`)
        for (;;) {
          const { rows } = await pool.query<CaptionRow & { hint: string | null }>(
            `update "caption" set status = 'processing', attempts = attempts + 1, "updatedAt" = now()
              where ("assetId", lang) = (select c."assetId",c.lang from caption c join asset a on a.id=c."assetId"
                where c.status='queued' and a.status='ready' and a."deletedAt" is null and c."nextAttemptAt"<=now()
                order by c."updatedAt" limit 1 for update of c skip locked for share of a skip locked)
              returning *`,
          )
          const job = rows[0]
          if (!job) break
          const asset = await getAssetRow(job.assetId)
          if (!asset || asset.status !== 'ready') {
            await pool.query(`update caption set status='queued' where "assetId"=$1 and lang=$2`, [job.assetId, job.lang])
            continue
          }
          try {
            await processCaption(asset, job.hint)
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            const again = (e as { retry?: boolean }).retry && job.attempts < MAX_ATTEMPTS
            console.error(`[captions] ${job.assetId} failed${again ? ', will retry' : ''}:`, message)
            await pool.query(
              `update "caption" set status = $3, error = $4, "nextAttemptAt" = now() + ($5 || ' seconds')::interval, "updatedAt" = now() where "assetId" = $1 and lang = $2`,
              [job.assetId, job.lang, again ? 'queued' : 'failed', message.slice(0, 500), String(60 * job.attempts)],
            )
          }
        }
      } catch (e) {
        console.error('[captions] error:', e instanceof Error ? e.message : e)
      } finally {
        state.busy = false
      }
    },
  }
  globalThis.__mxCaptioner = state
  setInterval(() => void state.tick(), 5000).unref()
  void state.tick()
  return state
}

export function kickCaptioner() {
  if (process.env.MEDIA_WORKER === 'off') return
  void startCaptioner().tick()
}

/* ------------------------------------------------ routes */
export async function handleCaptions(req: Request, row: AssetRow, lang?: string, absolute = false, db: Pick<typeof pool,'query'> = pool) {
  const m = req.method
  // API callers get absolute URLs
  const out = async () => (await listCaptions(row.id, db)).map((c) => ({ ...c, url: c.url && absolute ? `${baseURL}${c.url}` : c.url }))
  if (!lang && m === 'GET') return Response.json({ captions: await out(), available: captionsAvailable() }, { headers: { 'Cache-Control': 'no-store' } })
  if (lang === 'generate' && m === 'POST') {
    if (!captionsAvailable()) throw new HttpError(400, 'Automatic captions need an OpenAI key on the server (OPENAI_API_KEY).')
    if (row.status !== 'ready') throw new HttpError(409, 'Captions can be made once the asset is ready.')
    if (row.type === 'image') throw new HttpError(400, 'Images have nothing to caption.')
    const b = ((await req.json().catch(() => null)) ?? {}) as { language?: unknown }
    if (b.language !== undefined && (typeof b.language !== 'string' || !LANG.test(b.language))) throw new HttpError(400, 'language must be a code like “en” or “fr”.')
    await queueCaptions(row, b.language as string | undefined, db)
    return Response.json({ captions: await out() }, { status: 202 })
  }
  if (!lang || !LANG.test(lang)) throw new HttpError(404, 'Not found')
  if (m === 'PUT') {
    const b = ((await req.json().catch(() => null)) ?? {}) as { label?: unknown; text?: unknown }
    if (typeof b.text !== 'string' || !b.text.trim()) throw new HttpError(400, 'Send the captions as { text } (WebVTT or SRT).')
    if (b.text.length > 2_000_000) throw new HttpError(413, 'Caption files can be up to 2 MB.')
    const vtt = normaliseCaptions(b.text)
    const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 60) : languageLabel(lang)
    const key = `${prefixOf(row)}/captions/${lang}.vtt`
    await storage(row).putBuffer(key, Buffer.from(vtt), 'text/vtt')
    await db.query(
      `insert into "caption" ("assetId", lang, label, source, status, key) values ($1, $2, $3, 'upload', 'ready', $4)
       on conflict ("assetId", lang) do update set label = excluded.label, source = 'upload', status = 'ready', key = excluded.key, error = null, "updatedAt" = now()`,
      [row.id, lang, label, key],
    )
    return Response.json({ captions: await out() })
  }
  if (m === 'DELETE') {
    const { rows } = await db.query<{ key: string | null }>('delete from "caption" where "assetId" = $1 and lang = $2 returning key', [row.id, lang])
    if (!rows[0]) throw new HttpError(404, 'There’s no track in that language.')
    if (rows[0].key) await storage(row).remove(rows[0].key).catch(() => {})
    return new Response(null, { status: 204 })
  }
  throw new HttpError(405, 'Method not allowed')
}

/** The stored track for the public route, or null. */
export async function captionKey(assetId: string, lang: string) {
  if (!LANG.test(lang)) return null
  const { rows } = await pool.query<{ key: string | null }>(`select key from "caption" where "assetId" = $1 and lang = $2 and status = 'ready'`, [assetId, lang])
  return rows[0]?.key ?? null
}
