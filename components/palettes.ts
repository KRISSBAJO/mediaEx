export type Palette = {
  bg: string
  /** low */
  a: string
  /** mid */
  b: string
  /** high */
  c: string
}

/** Neutral greys for the Engine wave field; the page is monochrome with orange (#ff5b1f) reserved for CTAs. */
export const THEME: Palette = {
  bg: '#0a0a0a',
  a: '#3a3936',
  b: '#9a9994',
  c: '#f2f1ee',
}

export function currentPalette(): Palette {
  return THEME
}
