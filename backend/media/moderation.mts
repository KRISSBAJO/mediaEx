/**
 * Moderation: new uploads can wait in a review queue before anyone outside the workspace can see them.
 *
 * Modes (per workspace, in workspace_setting):
 *   off       everything is public by link as soon as it's ready (the default)
 *   all       every upload waits for a person (flags are shown as hints)
 *   flagged   uploads go public unless something flags them
 *
 * Flags come from the workspace's blocklist (words in the title, file name, tags or metadata) and, when the
 * workspace turns it on and the server has Claude credentials, an automatic look at the pictures (the image, or three
 * frames of a video). A failed or declined automatic review sends the asset to a person rather than approving it.
 *
 *   GET  /api/moderation/settings            any member
 *   PUT  /api/moderation/settings            { mode, blocklist, aiReview }   owners and admins
 *   GET  /api/moderation/queue?state=        pending (default) | rejected | approved
 *   POST /api/moderation/decide              { ids, decision: approve | reject, note? }   owners and admins
 *   POST /api/moderation/recheck             { ids }  run the flag checks again             owners and admins
 */
import { spawn } from 'node:child_process'
import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import { pool } from '../auth.mts'
import { HttpError, getAssetRow, requireMember, toDTO, type AssetRow } from './assets.mts'
import { listFields } from './fields.mts'
import { storage } from './storage.mts'
import { emitAsset } from './webhooks.mts'
import type { ModerationFlag, ModerationMode, ModerationSettings } from './types.mts'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const MODES: ModerationMode[] = ['off', 'all', 'flagged']

/** Claude credentials on the server (the SDK also reads ANTHROPIC_AUTH_TOKEN and ant profiles; the key is the usual one). */
export const aiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)

export async function getSettings(orgId: string): Promise<ModerationSettings> {
  const { rows } = await pool.query<{ moderationMode: ModerationMode; blocklist: string[]; aiReview: boolean }>(
    'select "moderationMode", blocklist, "aiReview" from "workspace_setting" where "organizationId" = $1',
    [orgId],
  )
  const r = rows[0]
  return { mode: r?.moderationMode ?? 'off', blocklist: r?.blocklist ?? [], aiReview: r?.aiReview ?? false, aiAvailable: aiAvailable() }
}

/** The state a brand-new upload starts in. */
export async function initialModeration(orgId: string) {
  return (await getSettings(orgId)).mode === 'off' ? 'approved' : 'pending'
}

/* ------------------------------------------------ checks */
function blocklistFlags(a: AssetRow, words: string[], fieldText: string): ModerationFlag[] {
  const hay = [a.title, a.fileName, ...(a.tags ?? []), fieldText].join(' ').toLowerCase()
  const hits = words.filter((w) => {
    const term = w.toLowerCase().trim()
    if (!term) return false
    // whole words, so "ass" doesn't flag "class"
    return new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(hay)
  })
  return hits.length ? [{ source: 'blocklist', reason: `Contains blocked ${hits.length === 1 ? 'word' : 'words'}: ${hits.join(', ')}` }] : []
}

function frame(input: string, at: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-ss', String(at), '-i', input, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { windowsHide: true })
    const out: Buffer[] = []
    p.stdout.on('data', (d: Buffer) => out.push(d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new Error('Couldn’t read a frame'))))
  })
}

/** Up to three pictures to look at, as small JPEGs. Audio has none. */
async function pictures(a: AssetRow): Promise<Buffer[]> {
  const store = storage(a)
  let raw: Buffer[] = []
  if (a.type === 'image') {
    const b = (a.posterKey && (await store.getBuffer(a.posterKey))) || (await store.getBuffer(a.originalKey))
    if (b) raw = [b]
  } else if (a.type === 'video') {
    const src = await store.readableUrl(a.originalKey)
    const d = a.duration || 1
    const times = d < 3 ? [0] : [d * 0.15, d * 0.5, d * 0.85]
    raw = (await Promise.allSettled(times.map((t) => frame(src, t)))).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  }
  return Promise.all(raw.map((b) => sharp(b, { failOn: 'none' }).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()))
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['flagged', 'categories', 'reason'],
  properties: {
    flagged: { type: 'boolean' },
    categories: { type: 'array', items: { type: 'string', enum: ['sexual', 'minors', 'violence', 'hate', 'self_harm', 'illegal', 'other'] } },
    reason: { type: 'string' },
  },
} as const

const PROMPT = `You review media uploaded to a company's video and image library before it can be shared publicly.
Look at the attached picture(s) - an image, or frames from one video - and decide whether a person should check it before it goes public.

Flag it when you see any of: sexual content or nudity; anything sexual or exploitative involving minors; graphic violence, gore or serious injury; hate symbols or hateful imagery; self-harm; clearly illegal activity.
Don't flag ordinary marketing, product, event, sport, news-style or artistic material, fully clothed people, mild action, or test patterns.

Answer with flagged, the matching categories (empty when not flagged), and one short sentence of reason a reviewer can act on.`

async function aiFlags(a: AssetRow): Promise<ModerationFlag[]> {
  const pics = await pictures(a)
  if (!pics.length) return []
  const client = new Anthropic()
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 1024,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            ...pics.map((p) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: p.toString('base64') } })),
            { type: 'text' as const, text: `${PROMPT}\n\nTitle: ${a.title}` },
          ],
        },
      ],
    })
    if (response.stop_reason === 'refusal') {
      return [{ source: 'ai', reason: 'The automatic review declined to assess this — a person should look.', categories: response.stop_details?.category ? [response.stop_details.category] : [] }]
    }
    const text = response.content.find((b) => b.type === 'text')
    const verdict = JSON.parse(text && text.type === 'text' ? text.text : '{}') as { flagged?: boolean; categories?: string[]; reason?: string }
    if (!verdict.flagged) return []
    return [{ source: 'ai', reason: (verdict.reason || 'Flagged by the automatic review.').slice(0, 300), categories: verdict.categories ?? [] }]
  } catch (e) {
    if (e instanceof Anthropic.APIError) return [{ source: 'system', reason: `The automatic review couldn’t run (${e.status ?? 'network'}), so a person should look.` }]
    if (e instanceof SyntaxError) return [{ source: 'system', reason: 'The automatic review gave an unreadable answer, so a person should look.' }]
    throw e
  }
}

/**
 * Runs the checks for a finished asset and sets its state. A decision a person already made is kept.
 * Called by the worker when an asset becomes ready, and by "check again".
 */
export async function reviewAsset(id: string, force = false) {
  const a = await getAssetRow(id)
  if (!a || a.status !== 'ready') return
  if (a.moderatedBy && !force) return
  const s = await getSettings(a.organizationId)
  if (s.mode === 'off' && !a.uploadPolicy?.review) {
    await pool.query(`update "asset" set moderation = 'approved', "moderationFlags" = '[]' where id = $1 and "deletedAt" is null`, [id])
    return
  }
  const fields = await listFields(a.organizationId)
  const fieldText = fields
    .map((f) => a.metadata?.[f.id])
    .flat()
    .filter((v) => typeof v === 'string')
    .join(' ')
  const flags = [...blocklistFlags(a, s.blocklist, fieldText), ...(s.aiReview && aiAvailable() ? await aiFlags(a) : [])]
  const state = a.uploadPolicy?.review || s.mode === 'all' || flags.length ? 'pending' : 'approved'
  await pool.query(
    `update "asset" set moderation = $2, "moderationFlags" = $3, "moderatedBy" = null, "moderatedAt" = null, "moderationNote" = null where id = $1 and "deletedAt" is null`,
    [id, state, JSON.stringify(flags)],
  )
  if (state === 'pending') await emitAsset(id, 'asset.review_required')
}

/* ------------------------------------------------ routes */
function cleanIds(v: unknown) {
  const ids = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^ast_[a-z0-9]{6,20}$/.test(x)))] : []
  if (!ids.length) throw new HttpError(400, 'No assets were selected.')
  if (ids.length > 200) throw new HttpError(400, 'Decide on up to 200 assets at a time.')
  return ids
}

export async function handleModeration(req: Request, sub?: string) {
  const member = await requireMember(req.headers)
  const { orgId, user, role } = member
  const manage = role === 'owner' || role === 'admin'
  const body = req.method === 'GET' ? {} : (((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>)

  if (sub === 'settings' && req.method === 'GET') return Response.json(await getSettings(orgId), { headers: { 'Cache-Control': 'no-store' } })
  if (sub === 'settings' && req.method === 'PUT') {
    if (!manage) throw new HttpError(403, 'Only owners and admins can change moderation.')
    const mode = body.mode as ModerationMode
    if (!MODES.includes(mode)) throw new HttpError(400, `mode must be one of: ${MODES.join(', ')}.`)
    const blocklist = Array.isArray(body.blocklist)
      ? [...new Set(body.blocklist.filter((w): w is string => typeof w === 'string').map((w) => w.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 200)
      : []
    const aiReview = body.aiReview === true
    if (aiReview && !aiAvailable()) throw new HttpError(400, 'Automatic review needs Claude credentials on the server (ANTHROPIC_API_KEY).')
    await pool.query(
      `insert into "workspace_setting" ("organizationId", "moderationMode", blocklist, "aiReview", "updatedAt") values ($1, $2, $3, $4, now())
       on conflict ("organizationId") do update set "moderationMode" = excluded."moderationMode", blocklist = excluded.blocklist, "aiReview" = excluded."aiReview", "updatedAt" = now()`,
      [orgId, mode, blocklist, aiReview],
    )
    return Response.json(await getSettings(orgId))
  }

  if (sub === 'queue' && req.method === 'GET') {
    const state = new URL(req.url).searchParams.get('state') ?? 'pending'
    if (!['pending', 'rejected', 'approved'].includes(state)) throw new HttpError(400, 'state must be pending, rejected or approved.')
    const { rows } = await pool.query<{ id: string }>(
      `select id from "asset" where "organizationId" = $1 and "deletedAt" is null and moderation = $2 and ($2 <> 'approved' or "moderatedAt" is not null)
        order by case when jsonb_array_length("moderationFlags") > 0 then 0 else 1 end, coalesce("moderatedAt", "createdAt") desc limit 300`,
      [orgId, state],
    )
    const assets = (await Promise.all(rows.map((r) => getAssetRow(r.id, orgId)))).filter((a): a is AssetRow => Boolean(a)).map(toDTO)
    const { rows: counts } = await pool.query<{ moderation: string; n: number }>(
      `select moderation, count(*)::int as n from "asset" where "organizationId" = $1 and "deletedAt" is null and moderation <> 'approved' group by moderation`,
      [orgId],
    )
    return Response.json({ assets, counts: Object.fromEntries(counts.map((c) => [c.moderation, c.n])) }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (sub === 'decide' && req.method === 'POST') {
    if (!manage) throw new HttpError(403, 'Only owners and admins can approve or reject.')
    const ids = cleanIds(body.ids)
    const decision = body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : null
    if (!decision) throw new HttpError(400, 'decision must be approve or reject.')
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) || null : null
    const { rowCount } = await pool.query(
      `update "asset" set moderation = $3, "moderatedBy" = $4, "moderatedAt" = now(), "moderationNote" = $5, "updatedAt" = now()
        where "organizationId" = $1 and "deletedAt" is null and id = any($2::text[])`,
      [orgId, ids, decision, user.id, note],
    )
    for (const id of ids) await emitAsset(id, decision === 'approved' ? 'asset.approved' : 'asset.rejected')
    return Response.json({ changed: rowCount })
  }

  if (sub === 'recheck' && req.method === 'POST') {
    if (!manage) throw new HttpError(403, 'Only owners and admins can run the checks again.')
    const ids = cleanIds(body.ids)
    const { rows } = await pool.query<{ id: string }>(`select id from "asset" where "organizationId" = $1 and "deletedAt" is null and id = any($2::text[]) and status = 'ready'`, [orgId, ids])
    for (const r of rows) await reviewAsset(r.id, true)
    return Response.json({ changed: rows.length })
  }
  throw new HttpError(404, 'Not found')
}

/** Can this request see the asset publicly? Approved assets: anyone with the link. Otherwise: workspace members only. */
export const isPublic = (a: Pick<AssetRow, 'moderation'>) => a.moderation === 'approved'
