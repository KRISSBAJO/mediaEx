/**
 * View analytics. The MediaEX player (share links and embeds) sends a heartbeat while someone watches; each viewing is
 * one row in `view_session`, updated in place. Members previewing in the dashboard aren't counted, and players other
 * than ours (a customer's own player on the raw stream URL) can't report, so they aren't either.
 *
 *   POST /api/media/:id/views          heartbeat from the player (public; same access rules as playback)
 *   GET  /api/analytics?range=&asset=  the workspace's numbers                       members
 *   GET  /api/v1/analytics?range=&asset=                                             API key, read
 *
 * A view is a session with at least VIEW_MIN seconds watched. Retention comes from how far each view got
 * (its furthest position), so it assumes people watch from the start; skipping ahead counts as having watched.
 */
import { pool } from '../auth.mts'
import { HttpError } from './assets.mts'
import type { AnalyticsRange, AnalyticsReport } from './types.mts'

const VIEW_MIN = 2
const RANGES: Record<AnalyticsRange, number> = { '7d': 7, '30d': 30, '90d': 90 }
const ID = /^[A-Za-z0-9]{16,40}$/

/* ------------------------------------------------ the heartbeat */
type Beat = {
  id?: unknown
  viewer?: unknown
  watch?: unknown // seconds played since the last beat
  position?: unknown // furthest point reached, seconds
  startupMs?: unknown // play pressed → first frame (sent once)
  rebufferMs?: unknown // stalled since the last beat
  bytes?: unknown // media bytes loaded since the last beat
  error?: unknown
  referrer?: unknown // host of the page embedding the player
  hour?: unknown // viewer's local hour when they started
  tz?: unknown // viewer's IANA time zone, a fallback for country
}

const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0)

export function deviceOf(ua: string) {
  if (/SmartTV|SMART-TV|HbbTV|AppleTV|CrKey|Roku|AFT[A-Z]|Tizen|Web0S|BRAVIA/i.test(ua)) return 'TV'
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'Tablet'
  if (/Mobi|iPhone|iPod|Android|IEMobile|Opera Mini/i.test(ua)) return 'Mobile'
  return 'Desktop'
}

// a viewer's time zone points to their country well enough when no CDN tells us (the most-used zones only)
const TZ_COUNTRY: Record<string, string> = {
  'Africa/Lagos': 'NG', 'Africa/Accra': 'GH', 'Africa/Nairobi': 'KE', 'Africa/Johannesburg': 'ZA', 'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA',
  'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN', 'Africa/Kampala': 'UG', 'Africa/Dar_es_Salaam': 'TZ', 'Africa/Addis_Ababa': 'ET', 'Africa/Kigali': 'RW',
  'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN', 'Africa/Douala': 'CM', 'Africa/Lusaka': 'ZM', 'Africa/Harare': 'ZW', 'Africa/Kinshasa': 'CD',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Lisbon': 'PT', 'Europe/Athens': 'GR',
  'Europe/Istanbul': 'TR', 'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA', 'Europe/Moscow': 'RU', 'Europe/Bucharest': 'RO', 'Europe/Budapest': 'HU',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Phoenix': 'US',
  'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Detroit': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
  'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA', 'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR',
  'America/Argentina/Buenos_Aires': 'AR', 'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Santiago': 'CL', 'America/Caracas': 'VE',
  'America/Jamaica': 'JM', 'America/Port_of_Spain': 'TT', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA',
  'Asia/Qatar': 'QA', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Singapore': 'SG', 'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH',
  'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Hong_Kong': 'HK', 'Asia/Shanghai': 'CN', 'Asia/Taipei': 'TW',
  'Asia/Seoul': 'KR', 'Asia/Tokyo': 'JP', 'Asia/Jerusalem': 'IL', 'Asia/Tehran': 'IR', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Pacific/Auckland': 'NZ',
}

/** Country from a CDN header when there is one, else from the viewer's time zone. */
function countryOf(headers: Headers, tz: unknown) {
  for (const h of ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'x-country-code']) {
    const v = headers.get(h)?.toUpperCase()
    if (v && /^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') return v
  }
  return typeof tz === 'string' ? (TZ_COUNTRY[tz] ?? null) : null
}

export async function recordBeat(req: Request, asset: { id: string; organizationId: string; duration: number }) {
  let b: Beat | null = null
  try {
    // sendBeacon posts text/plain; parse either way
    b = JSON.parse(await req.text()) as Beat
  } catch {
    throw new HttpError(400, 'Send the heartbeat as JSON.')
  }
  if (!b || typeof b.id !== 'string' || !ID.test(b.id) || typeof b.viewer !== 'string' || !ID.test(b.viewer)) throw new HttpError(400, 'A heartbeat needs an id and a viewer.')
  const duration = Math.max(asset.duration, 1)
  const referrer = typeof b.referrer === 'string' && /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i.test(b.referrer) ? b.referrer.toLowerCase() : null
  const hour = typeof b.hour === 'number' && Number.isInteger(b.hour) && b.hour >= 0 && b.hour < 24 ? b.hour : null
  const startup = num(b.startupMs, 60_000) || null
  await pool.query(
    `insert into "view_session" (id, "assetId", "organizationId", "viewerId", "watchSeconds", "maxPosition", "startupMs", "rebufferMs", bytes, errors, device, country, referrer, "localHour")
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (id) do update set
       "lastSeenAt" = now(),
       -- a beat can't claim more playing time than has passed since the last one
       "watchSeconds" = "view_session"."watchSeconds" + least(excluded."watchSeconds", extract(epoch from now() - "view_session"."lastSeenAt") + 5),
       "maxPosition" = greatest("view_session"."maxPosition", excluded."maxPosition"),
       "startupMs" = coalesce("view_session"."startupMs", excluded."startupMs"),
       "rebufferMs" = "view_session"."rebufferMs" + excluded."rebufferMs",
       bytes = "view_session".bytes + excluded.bytes,
       errors = greatest("view_session".errors, excluded.errors)
     where "view_session"."assetId" = excluded."assetId" and "view_session"."lastSeenAt" < now() - interval '1 second'`,
    [
      b.id, asset.id, asset.organizationId, b.viewer, num(b.watch, 30), num(b.position, duration + 1), startup, Math.round(num(b.rebufferMs, 60_000)),
      Math.round(num(b.bytes, 2e9)), b.error === true ? 1 : 0, deviceOf(req.headers.get('user-agent') ?? ''), countryOf(req.headers, b.tz), referrer, hour,
    ],
  )
  return new Response(null, { status: 204 })
}

/* ------------------------------------------------ the report */
export const rangeOf = (v: string | null): AnalyticsRange => (v && v in RANGES ? (v as AnalyticsRange) : '30d')

type Totals = { views: number; uniques: number; watch: number; startup: number | null; rebuffer: number; bytes: number; errors: number; completed: number }

async function totals(orgId: string, from: string, to: string, asset: string | null): Promise<Totals> {
  const { rows } = await pool.query<Totals>(
    `select count(*)::int as views, count(distinct "viewerId")::int as uniques, coalesce(sum("watchSeconds"), 0)::float as watch,
            avg("startupMs")::float as startup, coalesce(sum("rebufferMs"), 0)::float as rebuffer, coalesce(sum(bytes), 0)::float as bytes,
            coalesce(sum(errors), 0)::int as errors,
            count(*) filter (where v."maxPosition" >= greatest(a.duration, 1) * 0.9)::int as completed
       from "view_session" v join "asset" a on a.id = v."assetId"
      where v."organizationId" = $1 and v."startedAt" >= $2 and v."startedAt" < $3 and v."watchSeconds" >= ${VIEW_MIN} and ($4::text is null or v."assetId" = $4)`,
    [orgId, from, to, asset],
  )
  return rows[0]
}

// no comparison when the previous period had nothing to compare with
const change = (now: number, before: number) => (before ? (now - before) / before : null)
const ratio = (t: Totals) => (t.rebuffer ? t.rebuffer / (t.rebuffer + t.watch * 1000) : 0)

export async function report(orgId: string, range: AnalyticsRange, asset: string | null): Promise<AnalyticsReport> {
  const days = RANGES[range]
  const day = 86_400_000
  const end = new Date(Math.ceil(Date.now() / day) * day) // the end of today, UTC
  const start = new Date(end.getTime() - days * day)
  const prev = new Date(start.getTime() - days * day)
  const iso = (d: Date) => d.toISOString()
  const base = `from "view_session" v join "asset" a on a.id = v."assetId"
    where v."organizationId" = $1 and v."startedAt" >= $2 and v."startedAt" < $3 and v."watchSeconds" >= ${VIEW_MIN} and ($4::text is null or v."assetId" = $4)`
  const args = [orgId, iso(start), iso(end), asset]

  const [now, before, daily, hours, retention, countries, devices, sources, top, quality] = await Promise.all([
    totals(orgId, iso(start), iso(end), asset),
    totals(orgId, iso(prev), iso(start), asset),
    pool.query<{ day: Date; views: number; watch: number; viewers: number }>(
      `select date_trunc('day', v."startedAt" at time zone 'UTC') as day, count(*)::int as views, sum("watchSeconds")::float as watch, count(distinct "viewerId")::int as viewers ${base} group by 1`,
      args,
    ),
    pool.query<{ hour: number; views: number }>(`select "localHour" as hour, count(*)::int as views ${base} and "localHour" is not null group by 1`, args),
    pool.query<{ step: number; share: number }>(
      `with seen as (select v."maxPosition" / greatest(a.duration, 1) as p ${base})
       select s.step, (count(*) filter (where seen.p >= s.step / 40.0))::float / greatest(count(*), 1) * 100 as share
         from generate_series(0, 40) s(step) cross join seen group by s.step order by s.step`,
      args,
    ),
    pool.query<{ country: string | null; views: number }>(`select country, count(*)::int as views ${base} group by 1 order by 2 desc limit 8`, args),
    pool.query<{ device: string; watch: number }>(`select device, sum("watchSeconds")::float as watch ${base} group by 1 order by 2 desc`, args),
    pool.query<{ referrer: string | null; views: number }>(`select referrer, count(*)::int as views ${base} group by 1 order by 2 desc limit 8`, args),
    pool.query<{ id: string; title: string; type: string; views: number; watch: number; completed: number }>(
      `select a.id, a.title, a.type, count(*)::int as views, sum("watchSeconds")::float as watch,
              count(*) filter (where v."maxPosition" >= greatest(a.duration, 1) * 0.9)::int as completed
         ${base} group by a.id, a.title, a.type order by views desc limit 10`,
      args,
    ),
    pool.query<{ country: string | null; views: number; startup: number | null; rebuffer: number; watch: number; errors: number }>(
      `select country, count(*)::int as views, avg("startupMs")::float as startup, sum("rebufferMs")::float as rebuffer, sum("watchSeconds")::float as watch, sum(errors)::int as errors
         ${base} group by 1 order by 2 desc limit 8`,
      args,
    ),
  ])

  // every day in the range, zeros included, oldest first
  const byDay = new Map(daily.rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), r]))
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * day).toISOString().slice(0, 10)
    const r = byDay.get(d)
    return { date: d, views: r?.views ?? 0, watchHours: (r?.watch ?? 0) / 3600, viewers: r?.viewers ?? 0 }
  })
  const byHour = new Map(hours.rows.map((r) => [r.hour, r.views]))

  return {
    range,
    from: iso(start),
    to: iso(end),
    totals: {
      views: now.views,
      uniqueViewers: now.uniques,
      watchHours: now.watch / 3600,
      avgViewSeconds: now.views ? now.watch / now.views : 0,
      avgStartupMs: now.startup === null ? null : Math.round(now.startup),
      rebufferRatio: ratio(now),
      bytesDelivered: now.bytes,
      errorRate: now.views ? now.errors / now.views : 0,
      completionRate: now.views ? now.completed / now.views : 0,
    },
    change: {
      views: change(now.views, before.views),
      uniqueViewers: change(now.uniques, before.uniques),
      watchHours: change(now.watch, before.watch),
      avgViewSeconds: change(now.views ? now.watch / now.views : 0, before.views ? before.watch / before.views : 0),
      avgStartupMs: now.startup && before.startup ? change(now.startup, before.startup) : null,
      rebufferRatio: change(ratio(now), ratio(before)),
      bytesDelivered: change(now.bytes, before.bytes),
    },
    daily: series,
    hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, views: byHour.get(h) ?? 0 })),
    retention: now.views ? retention.rows.map((r) => ({ position: r.step * 2.5, share: Math.round(r.share * 10) / 10 })) : [],
    countries: countries.rows.map((r) => ({ country: r.country, views: r.views })),
    devices: devices.rows.map((r) => ({ device: r.device, share: now.watch ? (r.watch / now.watch) * 100 : 0 })),
    sources: sources.rows.map((r) => ({ referrer: r.referrer, views: r.views })),
    topAssets: top.rows.map((r) => ({ id: r.id, title: r.title, type: r.type, views: r.views, watchHours: r.watch / 3600, completionRate: r.views ? r.completed / r.views : 0 })),
    quality: quality.rows.map((r) => ({
      country: r.country,
      views: r.views,
      avgStartupMs: r.startup === null ? null : Math.round(r.startup),
      rebufferRatio: r.rebuffer ? r.rebuffer / (r.rebuffer + r.watch * 1000) : 0,
      errorRate: r.views ? r.errors / r.views : 0,
    })),
  }
}


export async function analyticsFor(orgId: string, req: Request) {
  const sp = new URL(req.url).searchParams
  const asset = sp.get('asset')
  if (asset !== null && !/^ast_[a-z0-9]{6,20}$/.test(asset)) throw new HttpError(400, 'asset must be an asset ID.')
  if (asset) {
    const { rows } = await pool.query('select 1 from "asset" where id = $1 and "organizationId" = $2', [asset, orgId])
    if (!rows[0]) throw new HttpError(404, 'That asset doesn’t exist in this workspace.')
  }
  return Response.json(await report(orgId, rangeOf(sp.get('range')), asset), { headers: { 'Cache-Control': 'no-store' } })
}
