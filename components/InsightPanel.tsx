import styles from './InsightPanel.module.css'

interface InsightPanelProps {
  insight: {
    summary: string
    verdict: string
    score: number
    keyPoints: string[]
    risks: string[]
    confidence: string
    generatedAt: Date
  }
}

const VERDICT_LABEL: Record<string, string> = {
  positive: 'Tono positivo',
  neutral: 'Tono neutro',
  negative: 'Tono negativo',
}
const CONFIDENCE_LABEL: Record<string, string> = { low: 'bassa', medium: 'media', high: 'alta' }

export function InsightPanel({ insight }: InsightPanelProps) {
  const tone = insight.verdict in VERDICT_LABEL ? insight.verdict : 'neutral'
  return (
    <div className={`${styles.card} ${styles[tone]}`}>
      <div className={styles.head}>
        <strong className={styles.verdict}>{VERDICT_LABEL[tone]}</strong>
        <span className={styles.meta}>
          Forza {insight.score}/5 · confidenza {CONFIDENCE_LABEL[insight.confidence] ?? insight.confidence}
        </span>
      </div>
      <p className={styles.summary}>{insight.summary}</p>
      {insight.keyPoints.length > 0 && (
        <div>
          <h3 className={styles.label}>Punti chiave</h3>
          <ul className={styles.list}>
            {insight.keyPoints.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {insight.risks.length > 0 && (
        <div>
          <h3 className={styles.label}>Rischi e incognite</h3>
          <ul className={styles.list}>
            {insight.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <p className={styles.footnote}>
        Sintesi generata da un modello IA su notizie e titoli dei video, aggiornata il{' '}
        {insight.generatedAt.toLocaleDateString('it-IT')}. Non è consulenza finanziaria.
      </p>
    </div>
  )
}
