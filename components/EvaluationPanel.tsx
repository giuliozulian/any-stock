import styles from './EvaluationPanel.module.css'
import type { Evaluation } from '@/lib/evaluate'

function fmtPct(pct: number | null): string {
  if (pct === null) return '—'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

export function EvaluationPanel({ evaluation }: { evaluation: Evaluation }) {
  const { sinceWatching, shortTerm, mediumTerm, longTerm, targetPrice, details } = evaluation

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>Valutazione</h2>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>Da quando lo segui</span>
          <span className={styles.value}>{fmtPct(sinceWatching.pct)}</span>
        </div>
        <p className={styles.note}>{sinceWatching.note}</p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>Segnale breve termine</span>
          <span className={styles.value}>{shortTerm.label}</span>
        </div>
        <p className={styles.note}>{shortTerm.note}</p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>Segnale medio termine</span>
          <span className={styles.value}>{mediumTerm.label}</span>
        </div>
        <p className={styles.note}>{mediumTerm.note}</p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>Segnale lungo termine</span>
          <span className={styles.value}>{longTerm.label}</span>
        </div>
        <p className={styles.note}>{longTerm.note}</p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>Target price stimato</span>
          <span className={styles.value}>{targetPrice.value === null ? '—' : `$${targetPrice.value.toFixed(2)}`}</span>
        </div>
        <p className={styles.note}>{targetPrice.note}</p>
      </div>

      <details className={styles.details}>
        <summary className={styles.summary}>Dettagli numerici</summary>
        <dl className={styles.detailList}>
          <div className={styles.detailRow}>
            <dt>PEG ratio</dt>
            <dd>{details.pegRatio ?? '—'}</dd>
          </div>
          <div className={styles.detailRow}>
            <dt>ROE</dt>
            <dd>{details.roe ?? '—'}</dd>
          </div>
          <div className={styles.detailRow}>
            <dt>Debt / equity</dt>
            <dd>{details.debtToEquity ?? '—'}</dd>
          </div>
          <div className={styles.detailRow}>
            <dt>Margine netto</dt>
            <dd>{details.netMargin ?? '—'}</dd>
          </div>
          <div className={styles.detailRow}>
            <dt>Dividend yield</dt>
            <dd>{details.dividendYield ?? '—'}</dd>
          </div>
          <div className={styles.detailRow}>
            <dt>Payout ratio</dt>
            <dd>{details.payoutRatio ?? '—'}</dd>
          </div>
        </dl>
      </details>
    </section>
  )
}
