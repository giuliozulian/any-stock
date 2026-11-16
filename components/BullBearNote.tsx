import { AiNote } from './AiNote'
import styles from './BullBearNote.module.css'

interface BullBearNoteProps {
  note: { bull: string[]; bear: string[]; generatedAt: Date }
}

export function BullBearNote({ note }: BullBearNoteProps) {
  return (
    <AiNote title="Pro e contro" label="Argomenti a confronto" generatedAt={note.generatedAt}>
      <div className={styles.cols}>
        <section className={`${styles.col} ${styles.bull}`} aria-label="A favore">
          <h3 className={styles.heading}>A favore</h3>
          {note.bull.length > 0 ? (
            <ul className={styles.list}>
              {note.bull.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Nessun argomento solido dai dati disponibili.</p>
          )}
        </section>
        <section className={`${styles.col} ${styles.bear}`} aria-label="Contro">
          <h3 className={styles.heading}>Contro</h3>
          {note.bear.length > 0 ? (
            <ul className={styles.list}>
              {note.bear.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Nessun rischio evidente dai dati disponibili.</p>
          )}
        </section>
      </div>
    </AiNote>
  )
}
