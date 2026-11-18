'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { FinvizScreen as Screen } from '@/lib/finviz-screen'
import { VERDICT, fmtNum, fmtPrice } from '@/lib/scan-verdict'
import styles from './FinvizScreen.module.css'

export function FinvizScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/finviz-screen', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setScreen(null)
        setError((data as { error?: string }).error ?? 'La ricerca non è riuscita')
        return
      }
      setScreen(data as Screen)
      // The stocks were added to the scan: reload the table so they show up.
      router.refresh()
    } catch {
      setError('La ricerca non è riuscita')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={styles.wrap} aria-label="Cerca su Finviz">
      <button
        type="button"
        className={styles.button}
        onClick={run}
        disabled={loading}
        title="Cerca su Finviz titoli USA con utili e vendite in forte crescita e trend rialzista, li aggiunge allo scanner e li controlla con le sue regole."
      >
        {loading ? 'Cerco su Finviz…' : 'Cerca su Finviz'}
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {screen && (
        <div className={styles.panel}>
          <p role="status" className={styles.summary}>
            {screen.picks.length === 0
              ? `Finviz ha trovato ${screen.total} titoli, ma nessuno passa anche i controlli su media a 50 giorni e distanza da massimi e minimi.`
              : `Finviz ha trovato ${screen.total} titoli; ${screen.passedTechnical} passano anche i controlli su media a 50 giorni e distanza da massimi e minimi.`}
            {screen.addedToScan > 0 ? ` ${screen.addedToScan} aggiunti alla lista dello scanner.` : ''}
            {screen.truncated ? ' Letti solo i primi risultati: la lista completa è più lunga.' : ''}
            <button type="button" className={styles.close} onClick={() => setScreen(null)}>
              Chiudi
            </button>
          </p>
          {screen.picks.length > 0 && (
            <ul className={styles.list}>
              {screen.picks.map((p) => {
                const tone = VERDICT[p.verdict].tone
                return (
                  <li key={p.symbol} className={styles.item}>
                    <div className={styles.head}>
                      <Link href={`/stock/${p.symbol}#minervini`} className={styles.symbol}>
                        {p.symbol}
                      </Link>
                      <span className={styles.chip} data-tone={tone}>
                        {p.label}
                      </span>
                      <span className={styles.meta}>
                        {p.passedCount}/8 · {fmtPrice(p.price)}
                        {p.rs !== null ? ` · RS ${fmtNum(p.rs, 0)}` : ''}
                      </span>
                    </div>
                    <p className={styles.text}>{p.text}</p>
                    {p.note && <p className={styles.note}>{p.note}</p>}
                  </li>
                )
              })}
            </ul>
          )}
          <p className={styles.fine}>
            {screen.noteAvailable ? 'Note generate da Gemini a partire dai numeri dello scanner.' : 'Note AI non disponibili in questo momento.'} Finviz non verifica SMA150, forza relativa e base: le calcola l’app. Non è consulenza finanziaria.
          </p>
        </div>
      )}
    </section>
  )
}
