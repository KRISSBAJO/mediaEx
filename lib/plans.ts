/** The public plans. One source for the pricing cards, the landing price dial and the comparison table. */
export type Plan = {
  name: 'Creator' | 'Pro' | 'Studio'
  blurb: string
  monthly: number
  yearly: number
  cta: string
  featured?: boolean
  /** storage included, in GB (1 TB = 1000 GB) */
  storageGb: number
  features: string[]
  /** the three lines the price dial shows for this plan */
  highlights: string[]
}

// Every line here is enforced or built: limits live in backend/media/billing.mts, features in backend/media/*.
export const PLANS: Plan[] = [
  {
    name: 'Creator',
    blurb: 'For solo creators getting started.',
    monthly: 0,
    yearly: 0,
    cta: 'Start free',
    storageGb: 100,
    features: ['100 GB storage', 'Streaming up to 1080p', '50 processing minutes / mo', 'Player, API, webhooks and analytics', 'Captions: automatic or uploaded', 'Signed playback links'],
    highlights: ['Streaming up to 1080p', '50 processing minutes a month', 'Player, API and analytics'],
  },
  {
    name: 'Pro',
    blurb: 'For creators and small teams shipping weekly.',
    monthly: 24,
    yearly: 19,
    cta: 'Go Pro',
    featured: true,
    storageGb: 2000,
    features: ['2 TB storage', 'Streaming up to 4K', '1,000 processing minutes / mo', 'HEVC and AV1 encoding', 'Everything in Creator'],
    highlights: ['Streaming up to 4K', '1,000 processing minutes a month', 'HEVC and AV1 encoding'],
  },
  {
    name: 'Studio',
    blurb: 'For studios and media teams at scale.',
    monthly: 99,
    yearly: 79,
    cta: 'Choose Studio',
    storageGb: 10000,
    features: ['10 TB storage, no hard cap', 'Streaming up to 8K', 'Unlimited processing minutes', 'HEVC and AV1 encoding', 'Everything in Pro'],
    highlights: ['Streaming up to 8K', 'Unlimited processing minutes', '10 TB storage, no hard cap'],
  },
]

/** the smallest plan whose storage covers `gb`; past the top plan's allowance it is still the top plan (Studio has no hard cap) */
export const planFor = (gb: number) => PLANS.find((p) => gb <= p.storageGb) ?? PLANS[PLANS.length - 1]

export const formatSize = (gb: number) => {
  if (gb < 1000) return `${gb < 100 ? Math.round(gb) : Math.round(gb / 10) * 10} GB`
  const tb = gb / 1000
  return `${tb < 10 ? tb.toFixed(1).replace(/\.0$/, '') : Math.round(tb)} TB`
}
