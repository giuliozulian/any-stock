import styles from './AiNote.module.css'

interface AiNoteProps {
  title: string
  label?: string
  aside?: React.ReactNode
  generatedAt: Date
  ariaLabel?: string
  children: React.ReactNode
}

// Contenitore comune per tutto ciò che è scritto dall'IA: sfondo violetto e badge fisso per distinguerlo dai dati.
export function AiNote({ title, label, aside, generatedAt, ariaLabel, children }: AiNoteProps) {
  return (
    <section className={styles.note} aria-label={ariaLabel ?? title}>
      <header className={styles.head}>
        <span className={styles.badge}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor">
            <path d="M8 0l1.7 5.3L15 7l-5.3 1.7L8 14l-1.7-5.3L1 7l5.3-1.7z" />
          </svg>
          {label ?? 'Scritto dall’IA'}
        </span>
        {aside}
      </header>
      <h2 className={styles.title}>{title}</h2>
      {children}
      <p className={styles.footnote}>
        Generato da un modello IA il {generatedAt.toLocaleDateString('it-IT')}. Può contenere errori e non è consulenza finanziaria.
      </p>
    </section>
  )
}
