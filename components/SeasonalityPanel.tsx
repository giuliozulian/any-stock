import type { FullHistory } from '@/lib/history'
import { seasonality } from '@/lib/seasonality'
import { SeasonalityView } from '@/components/SeasonalityView'
import styles from './SeasonalityPanel.module.css'

export function SeasonalityPanel({ history, now }: { history: FullHistory; now: Date }) {
  const { points, sparseBefore } = history
  if (points.length === 0) return <p className={styles.empty}>Storico non disponibile al momento.</p>

  const data = seasonality(points, now)
  if (!data) return <p className={styles.empty}>Storico troppo breve per la stagionalità.</p>

  return (
    <div className={styles.panel}>
      <SeasonalityView data={data} />
      <p className={styles.note}>
        Prezzi di chiusura corretti per gli split, dividendi esclusi. Fonte: Yahoo Finance. La stagionalità descrive il passato, non è una previsione.
        {sparseBefore !== null &&
          ` Prima del ${new Date(sparseBefore).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} i dati sono meno fitti di quelli giornalieri.`}
      </p>
    </div>
  )
}
