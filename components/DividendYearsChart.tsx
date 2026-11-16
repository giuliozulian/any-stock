import { formatDividendAmount } from '@/lib/dividend-text'
import type { DividendYear } from '@/lib/dividends'
import styles from './DividendYearsChart.module.css'

const W = 640
const H = 200
const PAD = { top: 12, right: 8, bottom: 22, left: 8 }
const MAX_LABELS = 10
const MAX_YEARS = 15

export function DividendYearsChart({ years, currency }: { years: DividendYear[]; currency: string | null }) {
  const shown = years.slice(-MAX_YEARS)
  if (shown.length === 0) return null

  const peak = shown.reduce((a, b) => (b.total > a.total ? b : a))
  const max = peak.total
  const plotH = H - PAD.top - PAD.bottom
  const slot = (W - PAD.left - PAD.right) / shown.length
  const barW = Math.min(36, slot * 0.7)
  const labelStep = Math.ceil(shown.length / MAX_LABELS)
  const paid = shown.filter((v) => v.total > 0).length
  const label = `Dividendi per azione anno per anno dal ${shown[0].year} al ${shown[shown.length - 1].year}: ${paid} anni con pagamenti su ${shown.length}.${max > 0 ? ` Massimo ${formatDividendAmount(max, currency)} nel ${peak.year}.` : ''}`

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={label}>
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className={styles.base} />
        {shown.map((v, i) => {
          if (v.total <= 0) return null
          const height = Math.max(1, (v.total / max) * plotH)
          return (
            <rect key={v.year} x={PAD.left + i * slot + (slot - barW) / 2} y={H - PAD.bottom - height} width={barW} height={height} rx={2} className={styles.bar} data-tone="paid" data-partial={v.partial ? 'true' : 'false'}>
              <title>{`${v.year}: ${formatDividendAmount(v.total, currency)} in ${v.count} ${v.count === 1 ? 'pagamento' : 'pagamenti'}${v.partial ? ' (parziale)' : ''}`}</title>
            </rect>
          )
        })}
        {shown.map((v, i) =>
          (shown.length - 1 - i) % labelStep === 0 ? (
            <text key={v.year} x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" className={styles.axis}>
              {v.year}
            </text>
          ) : null,
        )}
      </svg>
      <p className={styles.note}>
        {max > 0 && `Massimo: ${formatDividendAmount(max, currency)} (${peak.year})`}
        {shown.some((v) => v.partial) && `${max > 0 ? ' · ' : ''}Barre attenuate: anno parziale`}
      </p>
    </div>
  )
}
