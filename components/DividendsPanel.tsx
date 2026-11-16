import { dividendSentence } from '@/lib/dividend-text'
import { dividendSummary, type DividendHistory } from '@/lib/dividends'
import { DividendGrowth } from '@/components/DividendGrowth'
import { DividendYearsChart } from '@/components/DividendYearsChart'
import styles from './DividendsPanel.module.css'

export function DividendsPanel({ history, price, now }: { history: DividendHistory | null; price: number | null; now: Date }) {
  if (history === null) return <p className={styles.empty}>Dati sui dividendi non disponibili al momento.</p>

  const summary = dividendSummary(history.payments, now, price)
  if (!summary) return <p className={styles.empty}>Questo titolo non distribuisce dividendi.</p>

  return (
    <div className={styles.panel}>
      <section className={styles.card} aria-label="Riepilogo dei dividendi">
        <p className={styles.sentence}>{dividendSentence(summary, history.currency)}</p>
      </section>

      <section className={styles.card} aria-labelledby="dividends-years-title">
        <h2 id="dividends-years-title" className={styles.title}>
          Dividendi per anno
        </h2>
        <DividendYearsChart years={summary.years} currency={history.currency} />
      </section>

      {summary.growth.completeYears >= 2 && (
        <section className={styles.card} aria-labelledby="dividends-growth-title">
          <h2 id="dividends-growth-title" className={styles.title}>
            Crescita del dividendo
          </h2>
          <DividendGrowth growth={summary.growth} />
        </section>
      )}

      <p className={styles.note}>Importi per azione nella valuta del titolo, dividendi straordinari inclusi. Fonte: Yahoo Finance. I dividendi passati non garantiscono quelli futuri.</p>
    </div>
  )
}
