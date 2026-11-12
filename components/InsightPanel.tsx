import styles from './InsightPanel.module.css'

interface InsightPanelProps {
  insight: {
    summary: string
    verdict: string
    generatedAt: Date
  }
}

const VERDICT_LABEL: Record<string, string> = {
  positive: 'Tono positivo',
  neutral: 'Tono neutro',
  negative: 'Tono negativo',
}

export function InsightPanel({ insight }: InsightPanelProps) {
  const tone = insight.verdict in VERDICT_LABEL ? insight.verdict : 'neutral'
  return (
    <div className={`${styles.card} ${styles[tone]}`}>
      <div className={styles.head}>
        <span className={styles.label}>Sintesi IA di news e video</span>
        <strong className={styles.verdict}>{VERDICT_LABEL[tone]}</strong>
      </div>
      <p className={styles.summary}>{insight.summary}</p>
      <p className={styles.footnote}>
        Generata da un modello IA il {insight.generatedAt.toLocaleDateString('it-IT')}. Non è consulenza finanziaria.
      </p>
    </div>
  )
}
