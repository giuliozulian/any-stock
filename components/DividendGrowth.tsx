import { formatPct } from '@/lib/performance'
import type { DividendGrowthStats } from '@/lib/dividends'
import styles from './DividendGrowth.module.css'

type Tone = 'gain' | 'loss' | 'flat'

export function DividendGrowth({ growth }: { growth: DividendGrowthStats }) {
  if (growth.completeYears < 2) return null

  const tiles: Array<{ label: string; value: string; tone: Tone }> = [
    { label: 'Anni consecutivi di aumento', value: String(growth.consecutiveIncreases), tone: growth.consecutiveIncreases > 0 ? 'gain' : 'flat' },
  ]
  if (growth.cagr5Pct !== null) tiles.push({ label: 'Crescita annua media 5 anni', value: formatPct(growth.cagr5Pct), tone: growth.cagr5Pct >= 0 ? 'gain' : 'loss' })
  if (growth.cagr10Pct !== null) tiles.push({ label: 'Crescita annua media 10 anni', value: formatPct(growth.cagr10Pct), tone: growth.cagr10Pct >= 0 ? 'gain' : 'loss' })

  return (
    <>
      <dl className={styles.grid}>
        {tiles.map((t) => (
          <div key={t.label} className={styles.tile}>
            <dt className={styles.label}>{t.label}</dt>
            <dd className={styles.value} data-tone={t.tone}>
              {t.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.cuts}>{growth.cutYears.length > 0 ? `Tagli: ${growth.cutYears.join(', ')}` : `Nessun taglio dal ${growth.firstCompleteYear}`}</p>
    </>
  )
}
