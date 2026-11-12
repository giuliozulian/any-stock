export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#171c25" />
      <path d="M15 50 L32 14 L49 50" fill="none" stroke="#b08d57" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22.5 38 H41.5" fill="none" stroke="#b08d57" strokeWidth="5" strokeLinecap="round" />
      <circle cx="49" cy="15" r="5" fill="#4fc283" />
    </svg>
  )
}
