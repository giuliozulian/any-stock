'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { FinvizScreen as Screen } from '@/lib/finviz-screen'
import { VERDICT, fmtNum, fmtPrice } from '@/lib/scan-verdict'
import styles from './FinvizScreen.module.css'

export function FinvizScreen() {
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
    } catch {
      setError('La ricerca non è riuscita')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={styles.wrap} aria-labelledby="finviz-title">
      <h2 id="finviz-title" className={styles.title}>
        Lista Finviz
      </h2>
      <p className={styles.lead}>
        Titoli USA con utili e vendite in forte crescita e trend rialzista, cercati su Finviz e poi controllati con le regole dello scanner. Il verdetto e la nota non sono un consiglio di investimento.
      </p>
      <button type="button" className={styles.button} onClick={run} disabled={loading}>
        {loading ? 'Cerco su Finviz…' : 'Cerca con Finviz'}
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {screen && (
        <>
          <p role="status" className={styles.summary}>
            {screen.picks.length === 0
              ? `Finviz ha trovato ${screen.total} titoli, ma nessuno passa anche i controlli su media a 50 giorni e distanza da massimi e minimi.`
              : `Finviz ha trovato ${screen.total} titoli; ${screen.passedTechnical} passano anche i controlli su media a 50 giorni e distanza da massimi e minimi.`}
            {screen.truncated ? ' Letti solo i primi risultati: la lista completa è più lunga.' : ''}
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
            {screen.noteAvailable ? 'Note generate da Gemini a partire dai numeri dello scanner.' : 'Note AI non disponibili in questo momento.'} Finviz non verifica SMA150, forza relativa e base: le calcola l’app.
          </p>
        </>
      )}
    </section>
  )
}
