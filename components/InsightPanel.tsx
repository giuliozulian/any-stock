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
    <section className={`${styles.note} ${styles[tone]}`} aria-label="Sintesi IA di news e video">
      <header className={styles.head}>
        <h2 className={styles.title}>Sintesi IA di news e video</h2>
        <span className={styles.verdict}>{VERDICT_LABEL[tone]}</span>
      </header>
      <p className={styles.summary}>{insight.summary}</p>
      <p className={styles.footnote}>
        Generata da un modello IA il {insight.generatedAt.toLocaleDateString('it-IT')}. Non è consulenza finanziaria.
      </p>
    </section>
  )
}
