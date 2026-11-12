interface Snapshot {
  price: number
  timestamp: Date
}

export function PriceChart({
  snapshots,
  width = 300,
  height = 80,
}: {
  snapshots: Snapshot[]
  width?: number
  height?: number
}) {
  if (snapshots.length === 0) {
    return <p>No price history yet.</p>
  }

  if (snapshots.length === 1) {
    return <p>Only one data point so far: ${snapshots[0].price.toFixed(2)}</p>
  }

  const ordered = [...snapshots].reverse()
  const prices = ordered.map((s) => s.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1

  const points = ordered
    .map((s, i) => {
      const x = (i / (ordered.length - 1)) * width
      const y = height - ((s.price - min) / range) * height
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} role="img" aria-label="Price history chart">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  )
}
