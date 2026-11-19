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

export const PLANS: Plan[] = [
  {
    name: 'Creator',
    blurb: 'For solo creators getting started.',
    monthly: 0,
    yearly: 0,
    cta: 'Start free',
    storageGb: 100,
    features: ['100 GB storage', '1080p streaming', '50 transcode minutes / mo', 'Auto captions (EN)', 'Community support'],
    highlights: ['1080p streaming', '50 transcode minutes a month', 'Auto captions in English'],
  },
  {
    name: 'Pro',
    blurb: 'For creators and small teams shipping weekly.',
    monthly: 24,
    yearly: 19,
    cta: 'Go Pro',
    featured: true,
    storageGb: 2000,
    features: [
      '2 TB storage',
      '4K HDR streaming',
      '1,000 transcode minutes / mo',
      'AI Studio: 40+ caption languages',
      'Review links & version history',
      'Custom player branding',
    ],
    highlights: ['4K HDR streaming', '1,000 transcode minutes a month', 'Captions in 40+ languages'],
  },
  {
    name: 'Studio',
    blurb: 'For studios and media teams at scale.',
    monthly: 99,
    yearly: 79,
    cta: 'Talk to us',
    storageGb: 10000,
    features: [
      '10 TB storage, then pay as you go',
      '8K, Dolby Vision & Atmos',
      'Unlimited transcoding',
      'DRM, SSO & audit logs',
      'Dedicated edge capacity',
      '24/7 priority support',
    ],
    highlights: ['8K, Dolby Vision & Atmos', 'Unlimited transcoding', '24/7 priority support'],
  },
]

/** the smallest plan whose storage covers `gb`; past the top plan's allowance it is still the top plan, plus usage */
export const planFor = (gb: number) => PLANS.find((p) => gb <= p.storageGb) ?? PLANS[PLANS.length - 1]

export const formatSize = (gb: number) => {
  if (gb < 1000) return `${gb < 100 ? Math.round(gb) : Math.round(gb / 10) * 10} GB`
  const tb = gb / 1000
  return `${tb < 10 ? tb.toFixed(1).replace(/\.0$/, '') : Math.round(tb)} TB`
}
