import styles from './CandidateCard.module.css'

export interface DiscoveryInsightData {
  score: number
  momentumScore: number
  fundamentalsScore: number
  insiderScore: number
  reason: string
  market: string
}

const PILLARS = ['Andamento', 'Conti', 'Insider']

export function DiscoveryInsight({ data }: { data: DiscoveryInsightData }) {
  const [headline, ...details] = data.reason.split('\n')
  const scores = [data.momentumScore, data.fundamentalsScore, data.insiderScore]
  const tier = data.score >= 65 ? styles.tierHigh : data.score >= 40 ? styles.tierMid : ''
  const rows = data.market === 'IT' ? [0, 1] : [0, 1, 2]
  return (
    <section className={`${styles.card} ${tier}`} aria-label="Perché te lo suggeriamo">
      <div className={styles.top}>
        <div className={styles.scoreBox}>
          <div className={styles.ringWrap}>
            <div className={styles.ring} style={{ '--pct': `${data.score}%` } as React.CSSProperties} />
            <span className={styles.scoreValue}>{data.score}</span>
          </div>
          <span className={styles.scoreLabel}>Punteggio</span>
        </div>
        <div className={styles.body}>
          <h2 className={styles.symbol}>Perché te lo suggeriamo</h2>
          <p className={styles.reason}>{headline}</p>
          <ul className={styles.meters}>
            {rows.map((i) => (
              <li key={PILLARS[i]} className={styles.meter}>
                <span className={styles.meterLabel}>{PILLARS[i]}</span>
                <span className={styles.meterScore}>{scores[i]}/100</span>
                <span className={styles.meterBar} aria-hidden="true">
                  <span style={{ width: `${scores[i]}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {details.length > 0 && (
        <details className={styles.why}>
          <summary className={styles.whySummary}>Cosa abbiamo considerato</summary>
          <dl className={styles.whyList}>
            {details.slice(0, PILLARS.length).map((text, i) => (
              <div key={PILLARS[i]} className={styles.whyItem}>
                <dt>{PILLARS[i]}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  )
}
