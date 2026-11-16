import { formatPct, type YearReturn } from '@/lib/performance'
import styles from './YearlyReturnsChart.module.css'

const W = 640
const H = 200
const PAD = { top: 12, right: 8, bottom: 22, left: 8 }
const MAX_LABELS = 10

export function YearlyReturnsChart({ years }: { years: YearReturn[] }) {
  if (years.length === 0) return null

  const max = Math.max(0, ...years.map((y) => y.returnPct))
  const min = Math.min(0, ...years.map((y) => y.returnPct))
  const span = max - min || 1
  const plotH = H - PAD.top - PAD.bottom
  const y = (v: number) => PAD.top + ((max - v) / span) * plotH
  const slot = (W - PAD.left - PAD.right) / years.length
  const barW = Math.min(36, slot * 0.7)
  const labelStep = Math.ceil(years.length / MAX_LABELS)

  const best = years.reduce((a, b) => (b.returnPct > a.returnPct ? b : a))
  const worst = years.reduce((a, b) => (b.returnPct < a.returnPct ? b : a))
  const positive = years.filter((v) => v.returnPct > 0).length
  const describe = (v: YearReturn) => `${v.year} (${formatPct(v.returnPct)})`
  const label = `Rendimento anno per anno dal ${years[0].year} al ${years[years.length - 1].year}: ${positive} anni positivi su ${years.length}. Migliore ${describe(best)}, peggiore ${describe(worst)}.`

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={label}>
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className={styles.zero} />
        {years.map((v, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2
          const top = y(Math.max(v.returnPct, 0))
          const height = Math.max(1, Math.abs(y(v.returnPct) - y(0)))
          return (
            <rect key={v.year} x={x} y={top} width={barW} height={height} rx={2} className={styles.bar} data-tone={v.returnPct >= 0 ? 'gain' : 'loss'} data-partial={v.partial ? 'true' : 'false'}>
              <title>{`${v.year}: ${formatPct(v.returnPct)}${v.partial ? ' (parziale)' : ''}`}</title>
            </rect>
          )
        })}
        {years.map((v, i) =>
          (years.length - 1 - i) % labelStep === 0 ? (
            <text key={v.year} x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" className={styles.axis}>
              {v.year}
            </text>
          ) : null,
        )}
      </svg>
      <p className={styles.note}>
        Migliore: {describe(best)} · Peggiore: {describe(worst)}
        {years.some((v) => v.partial) && ' · Barre attenuate: anno parziale'}
      </p>
    </div>
  )
}
