/**
 * Sample data for the dashboard. MediaEX has no backend yet, so every number here is generated from a fixed seed
 * (the same on server and client, so hydration matches). The UI labels it "Sample data". Replace these exports with
 * real API calls when the backend exists.
 */

export type AssetType = 'video' | 'audio' | 'image'
export type AssetStatus = 'ready' | 'processing' | 'queued' | 'failed'

export type Asset = {
  id: string
  title: string
  type: AssetType
  status: AssetStatus
  progress: number // 0-100 while processing
  duration: number // seconds (0 for images)
  size: number // bytes
  resolution: string
  codec: string
  views: number
  watchHours: number
  createdDaysAgo: number
  thumb: number // composition seed for the generated thumbnail
  tags: string[]
}

export type Point = { label: string; value: number }

const TODAY = Date.UTC(2026, 10, 19) // fixed reference date so server and client render the same labels

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dayLabel(daysAgo: number) {
  const d = new Date(TODAY - daysAgo * 86400000)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
export function relDay(daysAgo: number) {
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo < 7) return `${daysAgo} days ago`
  return dayLabel(daysAgo)
}

/* ------------------------------------------------ workspace */
export const WORKSPACE = { name: 'Northwind Studios', slug: 'northwind', plan: 'Pro', initial: 'N' }
export const WORKSPACES = [
  WORKSPACE,
  { name: 'Lumen Pictures', slug: 'lumen', plan: 'Studio', initial: 'L' },
  { name: 'Personal', slug: 'ada', plan: 'Creator', initial: 'A' },
]
export const USER = { name: 'Ada Okafor', email: 'ada@northwind.studio', initials: 'AO' }

export const USAGE = {
  storage: { used: 1.42, limit: 2, unit: 'TB' },
  transcode: { used: 642, limit: 1000, unit: 'min' },
  bandwidth: { used: 18.6, limit: 25, unit: 'TB' },
  captions: { used: 212, limit: 500, unit: 'hrs' },
}

/* ------------------------------------------------ assets */
const RAW: [string, AssetType, AssetStatus, number, string[]][] = [
  ['Launch film — final cut', 'video', 'ready', 214, ['campaign', 'hero']],
  ['Podcast ep. 112: The edge of latency', 'audio', 'ready', 3260, ['podcast']],
  ['Behind the scenes — Lagos shoot', 'video', 'processing', 486, ['bts']],
  ['Campaign stills — Spring', 'image', 'ready', 0, ['campaign']],
  ['Product walkthrough v3', 'video', 'ready', 372, ['product']],
  ['Keynote 2026 — full session', 'video', 'ready', 3912, ['event']],
  ['Interview: Ada Okafor', 'video', 'queued', 1288, ['interview']],
  ['Teaser 15s — vertical', 'video', 'ready', 15, ['social', 'campaign']],
  ['Ambient loop — studio B', 'audio', 'ready', 600, ['music']],
  ['Trailer — Nightjar', 'video', 'ready', 142, ['trailer']],
  ['Live session: Driftwave', 'video', 'failed', 2710, ['music', 'live']],
  ['Tutorial: colour grading basics', 'video', 'ready', 1124, ['education']],
  ['Webinar recording — Q3 review', 'video', 'ready', 2840, ['webinar']],
  ['Field audio — Paris metro', 'audio', 'processing', 412, ['field']],
  ['Sizzle reel 2026', 'video', 'ready', 96, ['campaign']],
  ['Customer story — Halcyon', 'video', 'ready', 248, ['customer']],
  ['Album artwork set', 'image', 'ready', 0, ['music']],
  ['Short: coastal timelapse', 'video', 'ready', 58, ['social']],
]

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const ASSETS: Asset[] = RAW.map(([title, type, status, duration, tags], i) => {
  const r = rng(1000 + i * 17)
  const views = status === 'ready' ? Math.round(800 + r() * r() * 240000) : status === 'failed' ? 0 : 0
  const res = type === 'image' ? '6000 × 4000' : type === 'audio' ? '96 kHz · 24-bit' : ['3840 × 2160', '1920 × 1080', '1080 × 1920'][i % 3 === 1 ? 1 : i === 7 ? 2 : 0]
  const codec = type === 'image' ? 'RAW · 214 files' : type === 'audio' ? 'WAV → Opus, AAC' : 'ProRes 4444 → AV1, HEVC'
  const size = type === 'image' ? 3.1e9 : type === 'audio' ? duration * 576000 : duration * (res.startsWith('3840') ? 38e6 : 16e6)
  return {
    id: slug(title),
    title,
    type,
    status,
    progress: status === 'processing' ? Math.round(24 + r() * 60) : 0,
    duration,
    size,
    resolution: res,
    codec,
    views,
    watchHours: Math.round((views * (duration || 30) * (0.35 + r() * 0.3)) / 3600),
    createdDaysAgo: i === 2 || i === 6 || i === 13 ? 0 : Math.round(i * 1.7 + r() * 3),
    thumb: i,
    tags,
  }
})

export const getAsset = (id: string) => ASSETS.find((a) => a.id === id)

/* ------------------------------------------------ time series */
export type Range = '7d' | '30d' | '90d'
export const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 }

export function series(seed: number, days: number, base: number, opts: { trend?: number; noise?: number; weekly?: number } = {}): Point[] {
  const { trend = 0.004, noise = 0.12, weekly = 0.18 } = opts
  const r = rng(seed)
  const out: Point[] = []
  for (let i = days - 1; i >= 0; i--) {
    const t = days - 1 - i
    const dow = new Date(TODAY - i * 86400000).getUTCDay()
    const week = dow === 0 || dow === 6 ? 1 + weekly : 1 - weekly * 0.3
    const v = base * (1 + trend * (t - days)) * week * (1 + (r() - 0.5) * noise * 2)
    out.push({ label: dayLabel(i), value: Math.max(0, Math.round(v)) })
  }
  return out
}

export function sumOf(p: Point[]) {
  return p.reduce((s, x) => s + x.value, 0)
}

/** totals for a range, plus the change against the period before it */
export function metric(seed: number, range: Range, base: number, opts?: { trend?: number; noise?: number; weekly?: number }) {
  const days = RANGE_DAYS[range]
  const both = series(seed, days * 2, base, opts)
  const prev = sumOf(both.slice(0, days))
  const cur = both.slice(days)
  const total = sumOf(cur)
  return { points: cur, total, delta: prev ? (total - prev) / prev : 0 }
}

export const HOURS: Point[] = (() => {
  const r = rng(77)
  return Array.from({ length: 24 }, (_, h) => {
    const curve = 0.35 + 0.65 * Math.pow(Math.sin(((h - 6) / 24) * Math.PI * 2 * 0.5 + 0.2), 2)
    const evening = h >= 18 && h <= 22 ? 1.35 : 1
    return { label: `${String(h).padStart(2, '0')}:00`, value: Math.round(4200 * curve * evening * (0.9 + r() * 0.2)) }
  })
})()

export const RETENTION: Point[] = Array.from({ length: 41 }, (_, i) => {
  const p = i / 40
  const v = 100 * (0.62 * Math.exp(-p * 1.6) + 0.38 * (1 - p * 0.55)) - (p > 0.92 ? (p - 0.92) * 180 : 0)
  return { label: `${Math.round(p * 100)}%`, value: Math.max(0, Math.round(Math.min(100, v + (i === 0 ? 0 : 0)) * 10) / 10) }
})

export const COUNTRIES: Point[] = [
  { label: 'Nigeria', value: 184200 },
  { label: 'United States', value: 162900 },
  { label: 'United Kingdom', value: 88400 },
  { label: 'France', value: 61300 },
  { label: 'Ghana', value: 42800 },
  { label: 'Brazil', value: 31600 },
  { label: 'Other', value: 97200 },
]

export const DEVICES: Point[] = [
  { label: 'Mobile', value: 54.2 },
  { label: 'Desktop', value: 27.6 },
  { label: 'Smart TV', value: 13.1 },
  { label: 'Tablet', value: 5.1 },
]

export type Region = { region: string; pop: string; startMs: number; rebuffer: number; errors: number }
export const REGIONS: Region[] = [
  { region: 'Africa West', pop: 'LOS · ACC', startMs: 41, rebuffer: 0.31, errors: 0.02 },
  { region: 'Europe West', pop: 'CDG · LHR · AMS', startMs: 29, rebuffer: 0.18, errors: 0.01 },
  { region: 'North America East', pop: 'JFK · IAD · YYZ', startMs: 33, rebuffer: 0.22, errors: 0.01 },
  { region: 'North America West', pop: 'SFO · LAX · SEA', startMs: 36, rebuffer: 0.24, errors: 0.02 },
  { region: 'South America', pop: 'GRU · EZE', startMs: 58, rebuffer: 0.62, errors: 0.05 },
  { region: 'Asia Pacific', pop: 'SIN · NRT · SYD', startMs: 47, rebuffer: 0.41, errors: 0.03 },
]

/* ------------------------------------------------ pipeline + activity */
export const PIPELINE = ['Upload', 'Analyse', 'Encode', 'Captions', 'Package'] as const

export type Activity = { who: string; what: string; target?: string; when: string }
export const ACTIVITY: Activity[] = [
  { who: 'Pipeline', what: 'finished encoding', target: 'Launch film — final cut', when: '4 min ago' },
  { who: 'Jordan Reyes', what: 'approved', target: 'Teaser 15s — vertical', when: '22 min ago' },
  { who: 'Mina Lee', what: 'left 3 comments on', target: 'Product walkthrough v3', when: '1 hr ago' },
  { who: 'Pipeline', what: 'failed to package', target: 'Live session: Driftwave', when: '2 hr ago' },
  { who: 'Ada Okafor', what: 'uploaded', target: 'Behind the scenes — Lagos shoot', when: '3 hr ago' },
  { who: 'Sam Osei', what: 'created API key', target: 'ci-deploy', when: 'Yesterday' },
]

/* ------------------------------------------------ team */
export const MEMBERS = [
  { name: 'Ada Okafor', email: 'ada@northwind.studio', role: 'Owner', initials: 'AO', active: 'Now' },
  { name: 'Jordan Reyes', email: 'jordan@northwind.studio', role: 'Admin', initials: 'JR', active: '22 min ago' },
  { name: 'Mina Lee', email: 'mina@northwind.studio', role: 'Editor', initials: 'ML', active: '1 hr ago' },
  { name: 'Sam Osei', email: 'sam@northwind.studio', role: 'Developer', initials: 'SO', active: 'Yesterday' },
  { name: 'Client — Halcyon', email: 'review@halcyon.co', role: 'Reviewer', initials: 'HC', active: '3 days ago' },
]

/* ------------------------------------------------ formatting */
export function compact(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e4) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
  return n.toLocaleString('en-US')
}
export function bytes(n: number) {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e7) return `${Math.round(n / 1e6)} MB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`
  return `${Math.round(n)} B`
}
export function duration(s: number) {
  if (!s) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
export function pct(n: number, digits = 1) {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(digits)}%`
}
