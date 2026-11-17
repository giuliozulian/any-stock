import styles from './PivotGauge.module.css'

// The scale runs from 10% below the pivot to 8% above it; the buy zone is the 5% right above the pivot.
const MIN = -10
const MAX = 8
const BUY_LIMIT = 5

const place = (v: number) => Math.min(100, Math.max(0, ((v - MIN) / (MAX - MIN)) * 100))
const pct = (v: number) => Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function PivotGauge({ distancePct }: { distancePct: number | null }) {
  if (distancePct === null) return <span className={styles.none}>—</span>
  const zone = distancePct < 0 ? 'below' : distancePct <= BUY_LIMIT ? 'buy' : 'late'
  return (
    <span className={styles.gauge} role="img" aria-label={`${pct(distancePct)}% ${distancePct >= 0 ? 'sopra' : 'sotto'} il pivot`}>
      <span className={styles.zone} style={{ left: `${place(0)}%`, width: `${place(BUY_LIMIT) - place(0)}%` }} />
      <span className={styles.tick} style={{ left: `${place(0)}%` }} />
      <span className={styles.dot} data-zone={zone} style={{ left: `${place(distancePct)}%` }} />
    </span>
  )
}
