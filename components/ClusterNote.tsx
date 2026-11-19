import { getClusterNote, type ClusterNoteInput } from '@/lib/cluster-note'
import styles from './ClusterPanel.module.css'

// Server component: renders inside a Suspense boundary so the list shows up before the model answers.
export async function ClusterNote(props: ClusterNoteInput) {
  const note = await getClusterNote(props).catch(() => null)
  if (!note) return null
  return (
    <p className={styles.note}>
      <strong>Perché comprano?</strong> {note}
      <span className={styles.noteHint}>Lettura automatica dei soli dati degli acquisti, non una previsione.</span>
    </p>
  )
}
