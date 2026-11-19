export type Palette = {
  bg: string
  /** deep shade: orb body, shadows */
  a: string
  /** main accent: rims, highlights */
  b: string
  /** pale tint: hot spots */
  c: string
}

/** MediaEX uses a single blue accent; the 3D scenes draw only shades of it. Keep in sync with --accent in globals.css. */
export const THEME: Palette = {
  bg: '#07080b',
  a: '#2f4bd8',
  b: '#6f8cff',
  c: '#d6deff',
}

export function currentPalette(): Palette {
  return THEME
}
