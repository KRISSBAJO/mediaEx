export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#ff5b1f" />
      <path d="M12 9.5v13l10.5-6.5L12 9.5Z" fill="#0a0a0a" />
    </svg>
  )
}
