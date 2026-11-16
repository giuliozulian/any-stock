import type { FullHistory } from '@/lib/history'
import { downsample, drawdownSeries, drawdownSummary, periodReturns, yearlyReturns } from '@/lib/performance'
import { DrawdownChart } from '@/components/DrawdownChart'
import { PerformanceTiles } from '@/components/PerformanceTiles'
import { YearlyReturnsChart } from '@/components/YearlyReturnsChart'
import styles from './PerformancePanel.module.css'

export function PerformancePanel({ history, now }: { history: FullHistory; now: Date }) {
  const { points, sparseBefore } = history
  const summary = drawdownSummary(points, now)
  if (!summary) return <p className={styles.empty}>Storico non disponibile al momento.</p>

  return (
    <div className={styles.panel}>
      <section className={styles.card} aria-labelledby="performance-title">
        <h2 id="performance-title" className={styles.title}>
          Performance per periodo
        </h2>
        <PerformanceTiles returns={periodReturns(points, now)} />
      </section>
      <section className={styles.card} aria-labelledby="yearly-title">
        <h2 id="yearly-title" className={styles.title}>
          Anno per anno
        </h2>
        <YearlyReturnsChart years={yearlyReturns(points, now)} />
      </section>
      <section className={styles.card} aria-labelledby="drawdown-title">
        <h2 id="drawdown-title" className={styles.title}>
          Distanza dai massimi
        </h2>
        <DrawdownChart series={downsample(drawdownSeries(points), now)} summary={summary} />
      </section>
      <p className={styles.note}>
        Prezzi di chiusura corretti per gli split, dividendi esclusi. Fonte: Yahoo Finance.
        {sparseBefore !== null &&
          ` Prima del ${new Date(sparseBefore).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} i dati sono meno fitti di quelli giornalieri: i crolli di quel periodo possono risultare meno profondi di quanto sono stati.`}
      </p>
    </div>
  )
}
