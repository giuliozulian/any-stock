import { AiNote } from './AiNote'
import styles from './VerdictNote.module.css'

interface VerdictNoteProps {
  label?: string
  note: { headline: string; body: string; watchFor: string[]; generatedAt: Date }
}

export function VerdictNote({ note, label = 'Perché questi segnali' }: VerdictNoteProps) {
  return (
    <AiNote title={note.headline} label={label} generatedAt={note.generatedAt}>
      {note.body.split(/\n{2,}/).map((paragraph, i) => (
        <p key={i} className={styles.body}>
          {paragraph}
        </p>
      ))}
      {note.watchFor.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Da tenere d’occhio</h3>
          <ul className={styles.list}>
            {note.watchFor.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </AiNote>
  )
}
