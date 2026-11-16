import { formatPct, type PeriodKey, type PeriodReturn } from '@/lib/performance'
import styles from './PerformanceTiles.module.css'

const LABELS: Record<PeriodKey, string> = {
  '1M': '1 mese',
  '6M': '6 mesi',
  YTD: 'Da inizio anno',
  '1A': '1 anno',
  '3A': '3 anni',
  '5A': '5 anni',
  '10A': '10 anni',
  '20A': '20 anni',
  MAX: 'Tutto lo storico',
}

export function PerformanceTiles({ returns }: { returns: PeriodReturn[] }) {
  if (returns.length === 0) return null
  return (
    <dl className={styles.grid}>
      {returns.map((r) => (
        <div key={r.key} className={styles.tile}>
          <dt className={styles.label}>{LABELS[r.key]}</dt>
          <dd className={styles.value} data-tone={r.returnPct >= 0 ? 'gain' : 'loss'}>
            {formatPct(r.returnPct)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
