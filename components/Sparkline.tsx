interface Props {
  values: number[]
  width?: number
  height?: number
  label: string
}

// A tiny line of recent closes. Green when the period ended above where it started, red below.
export function Sparkline({ values, width = 96, height = 32, label }: Props) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ')
  const up = values[values.length - 1] >= values[0]
  return (
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', flex: 'none' }}>
      <polyline points={points} fill="none" stroke={up ? 'var(--gain-bright)' : 'var(--loss-bright)'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
