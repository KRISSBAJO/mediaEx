/**
 * The MediaEX wordmark: "media" in the display grotesk, then "EX" knocked out of an orange tag whose right edge is a
 * play arrow. The name is the logo; use this wherever the brand appears. `size` is the font size in pixels, so the
 * whole lockup scales with it. Styles: .wordmark in app/globals.css.
 */
export default function Logo({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`wordmark ${className}`} style={{ fontSize: size }} role="img" aria-label="MediaEX">
      <span className="wm-media" aria-hidden="true">
        media
      </span>
      <span className="wm-ex" aria-hidden="true">
        EX
      </span>
    </span>
  )
}
