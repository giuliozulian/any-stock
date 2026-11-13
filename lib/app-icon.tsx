import { ImageResponse } from 'next/og'

// Same mark as app/icon.svg, rendered to PNG because iOS and the install prompts need raster icons.
export function appIcon(size: number, { maskable = false }: { maskable?: boolean } = {}) {
  const inset = maskable ? 0.62 : 0.8
  const mark = size * inset
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09090b', borderRadius: maskable ? 0 : size * 0.22 }}>
        <svg width={mark} height={mark} viewBox="0 0 64 64">
          <path d="M15 50 L32 14 L49 50" fill="none" stroke="#3bf08c" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M22.5 38 H41.5" fill="none" stroke="#3bf08c" strokeWidth="5" strokeLinecap="round" />
          <circle cx="49" cy="15" r="5" fill="#4fc283" />
        </svg>
      </div>
    ),
    { width: size, height: size }
  )
}
