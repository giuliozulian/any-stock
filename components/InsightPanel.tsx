import styles from './InsightPanel.module.css'

interface InsightPanelProps {
  insight: {
    summary: string
    keyPoints: string[]
    risks: string[]
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
      {insight.summary.split(/\n{2,}/).map((paragraph, i) => (
        <p key={i} className={styles.summary}>
          {paragraph}
        </p>
      ))}
      {insight.keyPoints.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Notizie e impatto</h3>
          <ul className={styles.list}>
            {insight.keyPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      )}
      {insight.risks.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Rischi e incognite</h3>
          <ul className={styles.list}>
            {insight.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </div>
      )}
      <p className={styles.footnote}>
        Generata da un modello IA il {insight.generatedAt.toLocaleDateString('it-IT')}. Non è consulenza finanziaria.
      </p>
    </section>
  )
}
