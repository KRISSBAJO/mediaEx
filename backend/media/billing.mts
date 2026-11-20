/**
 * Plans, limits and billing. One billing layer with two providers behind it, picked by BILLING_PROVIDER:
 *
 *   stripe     STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET. Hosted Checkout to subscribe, the Customer Portal to change
 *              card or cancel. Prices are sent with each checkout (no products to create in Stripe first).
 *   paystack   PAYSTACK_SECRET_KEY (also signs webhooks). Paystack plans are created on first use and remembered;
 *              PAYSTACK_CURRENCY (default NGN) with PAYSTACK_PRICES="pro_month=36000,…" in that currency's main unit,
 *              or the USD list prices when the currency is USD.
 *
 * With neither configured, every workspace stays on Creator and upgrading says billing isn't set up.
 *
 *   GET  /api/billing                       plan, status, usage and what can be bought        members
 *   POST /api/billing/checkout              { plan, interval } → { url }                       owners and admins
 *   POST /api/billing/portal                → { url } to change card or cancel                 owners and admins
 *   POST /api/billing/cancel                cancel at the end of the period                    owners and admins
 *   POST /api/billing/webhook/stripe        Stripe events (signed)
 *   POST /api/billing/webhook/paystack      Paystack events (signed)
 *
 * Limits are enforced here too: storage when an upload starts, processing minutes when it's queued, the top rung of
 * the encoding ladder, and HEVC/AV1 (paid plans).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { baseURL, pool } from '../auth.mts'
import { HttpError, requireMember } from './assets.mts'
import { encodingGuards } from './encoding.mts'
import type { BillingInterval, BillingState, PlanId } from './types.mts'

/* ------------------------------------------------ plans */
export const PLANS: Record<PlanId, { name: string; month: number; year: number; storageBytes: number | null; minutes: number | null; maxShortSide: number; extraCodecs: boolean }> = {
  // prices in USD; yearly is the whole year (the site shows it per month)
  creator: { name: 'Creator', month: 0, year: 0, storageBytes: 100e9, minutes: 50, maxShortSide: 1080, extraCodecs: false },
  pro: { name: 'Pro', month: 24, year: 228, storageBytes: 2e12, minutes: 1000, maxShortSide: 2160, extraCodecs: true },
  // 10 TB included, then billed as you go: never blocked
  studio: { name: 'Studio', month: 99, year: 948, storageBytes: null, minutes: null, maxShortSide: 4320, extraCodecs: true },
}
const STUDIO_INCLUDED = 10e12
const PAID: PlanId[] = ['pro', 'studio']
const INTERVALS: BillingInterval[] = ['month', 'year']

export function provider(): 'stripe' | 'paystack' | null {
  const want = (process.env.BILLING_PROVIDER ?? '').toLowerCase()
  if (want === 'stripe') return process.env.STRIPE_SECRET_KEY ? 'stripe' : null
  if (want === 'paystack') return process.env.PAYSTACK_SECRET_KEY ? 'paystack' : null
  return process.env.STRIPE_SECRET_KEY ? 'stripe' : process.env.PAYSTACK_SECRET_KEY ? 'paystack' : null
}

type SubRow = {
  organizationId: string
  plan: PlanId
  interval: BillingInterval | null
  provider: 'stripe' | 'paystack' | null
  customerId: string | null
  subscriptionId: string | null
  emailToken: string | null
  status: 'active' | 'past_due' | 'canceled' | 'incomplete'
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

async function subscriptionOf(orgId: string): Promise<SubRow | null> {
  const { rows } = await pool.query<SubRow>('select * from "subscription" where "organizationId" = $1', [orgId])
  return rows[0] ?? null
}

/** The plan a workspace has right now: a paid plan until its period ends (cancelled or not), else Creator. */
export async function planOf(orgId: string): Promise<PlanId> {
  // a site admin's override (a comp, a trial, a correction) wins while it lasts
  const { rows: o } = await pool.query<{ planOverride: PlanId }>(
    `select "planOverride" from "workspace_admin" where "organizationId" = $1 and "planOverride" is not null and ("overrideUntil" is null or "overrideUntil" > now())`,
    [orgId],
  )
  if (o[0]) return o[0].planOverride
  const s = await subscriptionOf(orgId)
  if (!s || !PAID.includes(s.plan)) return 'creator'
  // a failed renewal keeps the plan for a week's grace
  const until = s.currentPeriodEnd ? s.currentPeriodEnd.getTime() + (s.status === 'past_due' ? 7 * 86400_000 : 0) : 0
  if (s.status === 'incomplete' || until < Date.now()) return 'creator'
  return s.plan
}

/** The current billing period: the subscription's, or the calendar month on Creator. */
async function period(orgId: string) {
  const s = await subscriptionOf(orgId)
  if (s?.currentPeriodStart && s.currentPeriodEnd && s.currentPeriodEnd.getTime() > Date.now() && PAID.includes(s.plan)) {
    return { start: s.currentPeriodStart, end: s.currentPeriodEnd }
  }
  const now = new Date()
  return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) }
}

export async function usage(orgId: string) {
  const { start, end } = await period(orgId)
  const { rows } = await pool.query<{ stored: string; minutes: number }>(
    `select coalesce(sum(size + "outputSize"), 0)::text as stored,
            coalesce(sum(duration) filter (where "readyAt" >= $2 and "readyAt" < $3 and type <> 'image'), 0)::float / 60 as minutes
       from "asset" where "organizationId" = $1`,
    [orgId, start, end],
  )
  return { storageBytes: Number(rows[0].stored), minutes: rows[0].minutes, periodStart: start.toISOString(), periodEnd: end.toISOString() }
}

/* ------------------------------------------------ limits */
const gb = (b: number) => (b >= 1e12 ? `${b / 1e12} TB` : `${Math.round(b / 1e9)} GB`)

/** Before an upload starts: does it fit the plan's storage? */
export async function assertStorage(orgId: string, adding: number) {
  const plan = PLANS[await planOf(orgId)]
  if (plan.storageBytes === null) return
  const { storageBytes } = await usage(orgId)
  if (storageBytes + adding > plan.storageBytes) {
    throw new HttpError(402, `This would go past your ${plan.name} plan’s ${gb(plan.storageBytes)} of storage (${gb(storageBytes)} used). Upgrade, or delete something first.`)
  }
}

/** Before an upload is queued: are there processing minutes left this period? */
export async function assertMinutes(orgId: string) {
  const plan = PLANS[await planOf(orgId)]
  if (plan.minutes === null) return
  const { minutes, periodEnd } = await usage(orgId)
  if (minutes >= plan.minutes) {
    throw new HttpError(402, `You’ve used this period’s ${plan.minutes} processing minutes on ${plan.name}. They reset on ${periodEnd.slice(0, 10)}, or upgrade for more.`)
  }
}

/** The tallest rung (short side, in pixels) the ladder may have on this plan. */
export async function maxShortSide(orgId: string) {
  return PLANS[await planOf(orgId)].maxShortSide
}

encodingGuards.push(async (orgId, codecs) => {
  if (codecs.length && !PLANS[await planOf(orgId)].extraCodecs) throw new HttpError(402, 'HEVC and AV1 come with Pro and Studio. Upgrade to turn them on.')
})

/* ------------------------------------------------ state for the dashboard */
function paystackPrices(): Partial<Record<`${PlanId}_${BillingInterval}`, number>> | null {
  const currency = (process.env.PAYSTACK_CURRENCY || 'NGN').toUpperCase()
  const raw = process.env.PAYSTACK_PRICES
  if (raw) {
    const out: Record<string, number> = {}
    for (const part of raw.split(',')) {
      const [k, v] = part.split('=').map((x) => x.trim())
      if (/^(pro|studio)_(month|year)$/.test(k) && Number(v) > 0) out[k] = Number(v)
    }
    return out
  }
  return currency === 'USD' ? { pro_month: 24, pro_year: 228, studio_month: 99, studio_year: 948 } : null
}

function priceOf(plan: PlanId, interval: BillingInterval): { amount: number; currency: string } | null {
  const p = provider()
  if (p === 'paystack') {
    const amount = paystackPrices()?.[`${plan}_${interval}`]
    return amount ? { amount, currency: (process.env.PAYSTACK_CURRENCY || 'NGN').toUpperCase() } : null
  }
  return { amount: PLANS[plan][interval], currency: 'USD' }
}

export async function billingState(orgId: string): Promise<BillingState> {
  const s = await subscriptionOf(orgId)
  const plan = await planOf(orgId)
  const u = await usage(orgId)
  const p = PLANS[plan]
  return {
    plan,
    planName: p.name,
    interval: plan === 'creator' ? null : (s?.interval ?? null),
    status: plan === 'creator' ? 'free' : (s?.status ?? 'active'),
    cancelAtPeriodEnd: plan !== 'creator' && !!s?.cancelAtPeriodEnd,
    currentPeriodEnd: plan !== 'creator' && s?.currentPeriodEnd ? s.currentPeriodEnd.toISOString() : null,
    provider: provider(),
    manageable: plan !== 'creator' && !!s?.customerId && s.provider === provider(),
    usage: {
      ...u,
      storageLimit: p.storageBytes ?? STUDIO_INCLUDED,
      storageOverage: p.storageBytes === null ? Math.max(0, u.storageBytes - STUDIO_INCLUDED) : 0,
      minutesLimit: p.minutes,
    },
    prices: PAID.flatMap((pl) => INTERVALS.map((iv) => ({ plan: pl, interval: iv, ...(priceOf(pl, iv) ?? { amount: 0, currency: '' }) }))).filter((x) => x.amount > 0),
  }
}

/* ------------------------------------------------ Stripe */
const stripeBase = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '')

function form(obj: Record<string, string | number | boolean | undefined>) {
  const f = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) f.append(k, String(v))
  return f
}

async function stripe<T>(method: 'GET' | 'POST', path: string, body?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const res = await fetch(`${stripeBase()}/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? form(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok) throw new HttpError(502, `Stripe: ${json.error?.message ?? `request failed (${res.status})`}`)
  return json
}

type StripeSub = {
  id: string
  customer: string
  status: string
  cancel_at_period_end: boolean
  current_period_start?: number
  current_period_end?: number
  items?: { data: { current_period_start?: number; current_period_end?: number; price?: { recurring?: { interval?: string } } }[] }
  metadata?: Record<string, string>
}

async function saveStripeSub(sub: StripeSub, orgHint?: string) {
  const orgId = sub.metadata?.orgId ?? orgHint
  if (!orgId) return
  const item = sub.items?.data?.[0]
  // newer Stripe API versions keep the period on the subscription item
  const start = sub.current_period_start ?? item?.current_period_start
  const end = sub.current_period_end ?? item?.current_period_end
  const plan = (PAID.includes(sub.metadata?.plan as PlanId) ? sub.metadata!.plan : 'pro') as PlanId
  const interval: BillingInterval = item?.price?.recurring?.interval === 'year' || sub.metadata?.interval === 'year' ? 'year' : 'month'
  const status = sub.status === 'active' || sub.status === 'trialing' ? 'active' : sub.status === 'past_due' || sub.status === 'unpaid' ? 'past_due' : sub.status === 'canceled' ? 'canceled' : 'incomplete'
  await pool.query(
    `insert into "subscription" ("organizationId", plan, interval, provider, "customerId", "subscriptionId", status, "currentPeriodStart", "currentPeriodEnd", "cancelAtPeriodEnd", "updatedAt")
     values ($1, $2, $3, 'stripe', $4, $5, $6, to_timestamp($7), to_timestamp($8), $9, now())
     on conflict ("organizationId") do update set plan = excluded.plan, interval = excluded.interval, provider = 'stripe', "customerId" = excluded."customerId",
       "subscriptionId" = excluded."subscriptionId", status = excluded.status, "currentPeriodStart" = excluded."currentPeriodStart",
       "currentPeriodEnd" = excluded."currentPeriodEnd", "cancelAtPeriodEnd" = excluded."cancelAtPeriodEnd", "updatedAt" = now()`,
    [orgId, plan, interval, sub.customer, sub.id, status, start ?? null, end ?? null, sub.cancel_at_period_end],
  )
}

function verifyStripe(raw: string, header: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !header) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]).filter((p) => p.length === 2))
  const t = Number(parts.t)
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest()
  return header
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .some((p) => {
      const given = Buffer.from(p.slice(3), 'hex')
      return given.length === expected.length && timingSafeEqual(given, expected)
    })
}

async function stripeWebhook(raw: string, req: Request) {
  if (!verifyStripe(raw, req.headers.get('stripe-signature'))) throw new HttpError(400, 'Bad signature.')
  const event = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } }
  if (!(await firstTime('stripe', event.id, event.type))) return Response.json({ received: true, duplicate: true })
  const o = event.data.object
  if (event.type === 'checkout.session.completed' && o.mode === 'subscription' && typeof o.subscription === 'string') {
    await saveStripeSub(await stripe<StripeSub>('GET', `subscriptions/${o.subscription}`), (o.metadata as Record<string, string> | undefined)?.orgId ?? (o.client_reference_id as string | undefined))
  } else if (event.type.startsWith('customer.subscription.')) {
    await saveStripeSub(o as unknown as StripeSub)
  } else if (event.type === 'invoice.payment_failed' && typeof o.customer === 'string') {
    await pool.query(`update "subscription" set status = 'past_due', "updatedAt" = now() where provider = 'stripe' and "customerId" = $1`, [o.customer])
  }
  return Response.json({ received: true })
}

/* ------------------------------------------------ Paystack */
const paystackBase = () => (process.env.PAYSTACK_API_BASE || 'https://api.paystack.co').replace(/\/$/, '')

async function paystack<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${paystackBase()}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T }
  if (!res.ok || !json.status) throw new HttpError(502, `Paystack: ${json.message ?? `request failed (${res.status})`}`)
  return json.data as T
}

/** Paystack subscriptions need a plan object per price; make it once and remember its code. */
async function paystackPlan(plan: PlanId, interval: BillingInterval, amount: number, currency: string) {
  const { rows } = await pool.query<{ code: string }>(
    'select code from "billing_plan" where provider = $1 and plan = $2 and interval = $3 and currency = $4 and amount = $5',
    ['paystack', plan, interval, currency, amount],
  )
  if (rows[0]) return rows[0].code
  const made = await paystack<{ plan_code: string }>('POST', 'plan', {
    name: `MediaEX ${PLANS[plan].name} (${interval === 'year' ? 'yearly' : 'monthly'})`,
    interval: interval === 'year' ? 'annually' : 'monthly',
    amount: Math.round(amount * 100),
    currency,
  })
  await pool.query('insert into "billing_plan" (provider, plan, interval, currency, amount, code) values ($1, $2, $3, $4, $5, $6) on conflict do nothing', [
    'paystack', plan, interval, currency, amount, made.plan_code,
  ])
  return made.plan_code
}

const verifyPaystack = (raw: string, header: string | null) => {
  if (!header || !process.env.PAYSTACK_SECRET_KEY) return false
  const expected = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest()
  const given = Buffer.from(header, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

const addInterval = (from: Date, interval: BillingInterval) => {
  const d = new Date(from)
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return d
}

async function paystackWebhook(raw: string, req: Request) {
  if (!verifyPaystack(raw, req.headers.get('x-paystack-signature'))) throw new HttpError(400, 'Bad signature.')
  const event = JSON.parse(raw) as { event: string; data: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = event.data
  // Paystack events have no id; the transaction reference or subscription code plus the event name is unique enough
  const eventId = `${event.event}:${d.reference ?? d.subscription_code ?? d.id ?? ''}:${d.next_payment_date ?? d.paid_at ?? ''}`
  if (!(await firstTime('paystack', eventId, event.event))) return Response.json({ received: true, duplicate: true })
  const customer: string | undefined = d.customer?.customer_code
  if (!customer) return Response.json({ received: true })
  const { rows } = await pool.query<SubRow>(`select * from "subscription" where provider = 'paystack' and "customerId" = $1`, [customer])
  const sub = rows[0]
  if (!sub) return Response.json({ received: true, unknown: true })

  if (event.event === 'charge.success' && d.plan?.plan_code) {
    // first payment or a renewal: the plan is on until the end of the period it paid for
    const known = await pool.query<{ plan: PlanId; interval: BillingInterval }>(`select plan, interval from "billing_plan" where provider = 'paystack' and code = $1`, [d.plan.plan_code])
    const plan = known.rows[0]?.plan ?? sub.plan
    const interval = known.rows[0]?.interval ?? sub.interval ?? 'month'
    const paid = d.paid_at ? new Date(d.paid_at) : new Date()
    const end = addInterval(paid, interval)
    await pool.query(
      `update "subscription" set plan = $2, interval = $3, status = 'active', "currentPeriodStart" = $4,
         "currentPeriodEnd" = greatest(coalesce("currentPeriodEnd", $5), $5), "updatedAt" = now() where "organizationId" = $1`,
      [sub.organizationId, plan, interval, paid, end],
    )
  } else if (event.event === 'subscription.create') {
    await pool.query(
      `update "subscription" set "subscriptionId" = $2, "emailToken" = $3, status = 'active', "cancelAtPeriodEnd" = false,
         "currentPeriodEnd" = coalesce($4::timestamptz, "currentPeriodEnd"), "updatedAt" = now() where "organizationId" = $1`,
      [sub.organizationId, d.subscription_code, d.email_token, d.next_payment_date ?? null],
    )
  } else if (event.event === 'invoice.payment_failed') {
    await pool.query(`update "subscription" set status = 'past_due', "updatedAt" = now() where "organizationId" = $1`, [sub.organizationId])
  } else if (event.event === 'subscription.not_renew') {
    await pool.query(`update "subscription" set "cancelAtPeriodEnd" = true, "updatedAt" = now() where "organizationId" = $1`, [sub.organizationId])
  } else if (event.event === 'subscription.disable') {
    // it has ended: Creator from now on (unless the paid period still runs)
    await pool.query(`update "subscription" set status = 'canceled', "cancelAtPeriodEnd" = false, "updatedAt" = now() where "organizationId" = $1`, [sub.organizationId])
  }
  return Response.json({ received: true })
}

/* ------------------------------------------------ shared */
/** Records a provider event; false when it was already handled (providers retry). */
async function firstTime(prov: string, id: string, type: string) {
  const { rowCount } = await pool.query('insert into "billing_event" (provider, "eventId", type) values ($1, $2, $3) on conflict do nothing', [prov, id, type])
  return rowCount === 1
}

const back = (q = '') => `${baseURL}/dashboard/settings?tab=billing${q}`

async function checkout(orgId: string, email: string, plan: PlanId, interval: BillingInterval) {
  const prov = provider()
  if (!prov) throw new HttpError(503, 'Billing isn’t set up on this server yet (STRIPE_SECRET_KEY or PAYSTACK_SECRET_KEY).')
  const price = priceOf(plan, interval)
  if (!price) throw new HttpError(503, `There’s no ${PLANS[plan].name} ${interval === 'year' ? 'yearly' : 'monthly'} price in ${process.env.PAYSTACK_CURRENCY || 'NGN'} yet. Set PAYSTACK_PRICES.`)
  const current = await subscriptionOf(orgId)
  if ((await planOf(orgId)) !== 'creator' && current?.provider === prov && !current.cancelAtPeriodEnd) {
    throw new HttpError(409, 'This workspace already has a paid plan. Change or cancel it from Manage billing.')
  }

  if (prov === 'stripe') {
    const session = await stripe<{ url: string }>('POST', 'checkout/sessions', {
      mode: 'subscription',
      ...(current?.provider === 'stripe' && current.customerId ? { customer: current.customerId } : { customer_email: email }),
      client_reference_id: orgId,
      'metadata[orgId]': orgId,
      'subscription_data[metadata][orgId]': orgId,
      'subscription_data[metadata][plan]': plan,
      'subscription_data[metadata][interval]': interval,
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': Math.round(price.amount * 100),
      'line_items[0][price_data][recurring][interval]': interval,
      'line_items[0][price_data][product_data][name]': `MediaEX ${PLANS[plan].name}`,
      allow_promotion_codes: true,
      success_url: back('&checkout=done'),
      cancel_url: back(),
    })
    return session.url
  }

  // Paystack: a customer first, so every event about this workspace can be matched to it
  const cust = await paystack<{ customer_code: string }>('POST', 'customer', { email, metadata: { orgId } })
  await pool.query(
    `insert into "subscription" ("organizationId", plan, interval, provider, "customerId", status, "updatedAt") values ($1, $2, $3, 'paystack', $4, 'incomplete', now())
     on conflict ("organizationId") do update set provider = 'paystack', "customerId" = excluded."customerId", plan = excluded.plan, interval = excluded.interval,
       status = case when "subscription".status = 'active' and "subscription"."currentPeriodEnd" > now() then "subscription".status else 'incomplete' end, "updatedAt" = now()`,
    [orgId, plan, interval, cust.customer_code],
  )
  const code = await paystackPlan(plan, interval, price.amount, price.currency)
  const tx = await paystack<{ authorization_url: string }>('POST', 'transaction/initialize', {
    email,
    amount: Math.round(price.amount * 100),
    currency: price.currency,
    plan: code,
    callback_url: back('&checkout=done'),
    metadata: { orgId, plan, interval },
  })
  return tx.authorization_url
}

async function portal(orgId: string) {
  const s = await subscriptionOf(orgId)
  if (!s?.customerId || s.provider !== provider()) throw new HttpError(409, 'There’s no paid plan to manage.')
  if (s.provider === 'stripe') return (await stripe<{ url: string }>('POST', 'billing_portal/sessions', { customer: s.customerId, return_url: back() })).url
  if (!s.subscriptionId) throw new HttpError(409, 'The subscription is still being set up. Try again in a minute.')
  return (await paystack<{ link: string }>('GET', `subscription/${s.subscriptionId}/manage/link`)).link
}

async function cancel(orgId: string) {
  const s = await subscriptionOf(orgId)
  if (!s?.subscriptionId || (await planOf(orgId)) === 'creator') throw new HttpError(409, 'There’s no paid plan to cancel.')
  if (s.provider === 'stripe') {
    await saveStripeSub(await stripe<StripeSub>('POST', `subscriptions/${s.subscriptionId}`, { cancel_at_period_end: true }), orgId)
  } else {
    await paystack('POST', 'subscription/disable', { code: s.subscriptionId, token: s.emailToken })
    // Paystack stops renewing; the paid period still runs to its end
    await pool.query(`update "subscription" set "cancelAtPeriodEnd" = true, "updatedAt" = now() where "organizationId" = $1`, [orgId])
  }
}

/* ------------------------------------------------ routes */
export async function handleBilling(req: Request, parts: string[]) {
  const [, , sub, which] = parts // api, billing, sub?, provider?
  if (sub === 'webhook' && req.method === 'POST') {
    const raw = await req.text()
    if (which === 'stripe') return stripeWebhook(raw, req)
    if (which === 'paystack') return paystackWebhook(raw, req)
    throw new HttpError(404, 'Not found')
  }
  const m = await requireMember(req.headers)
  if (!sub && req.method === 'GET') return Response.json(await billingState(m.orgId), { headers: { 'Cache-Control': 'no-store' } })
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')
  if (m.role !== 'owner' && m.role !== 'admin') throw new HttpError(403, 'Only owners and admins can change the plan.')
  if (sub === 'checkout') {
    const b = ((await req.json().catch(() => null)) ?? {}) as { plan?: unknown; interval?: unknown }
    if (!PAID.includes(b.plan as PlanId)) throw new HttpError(400, 'plan must be "pro" or "studio".')
    if (!INTERVALS.includes(b.interval as BillingInterval)) throw new HttpError(400, 'interval must be "month" or "year".')
    return Response.json({ url: await checkout(m.orgId, m.user.email, b.plan as PlanId, b.interval as BillingInterval) })
  }
  if (sub === 'portal') return Response.json({ url: await portal(m.orgId) })
  if (sub === 'cancel') {
    await cancel(m.orgId)
    return Response.json(await billingState(m.orgId))
  }
  throw new HttpError(404, 'Not found')
}
