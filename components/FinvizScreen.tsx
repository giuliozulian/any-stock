'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { FinvizScreen as Screen } from '@/lib/finviz-screen'
import { VERDICT, fmtNum, fmtPrice } from '@/lib/scan-verdict'
import styles from './FinvizScreen.module.css'

// What the search is doing, so the wait (up to a minute) is not a silent button.
const STEPS = ['Leggo i titoli su Finviz…', 'Controllo il trend di ognuno con le regole dello scanner…', 'Scrivo le note…']

export function FinvizScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen | null>(null)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!loading) return
    setStep(0)
    const timers = [setTimeout(() => setStep(1), 5_000), setTimeout(() => setStep(2), 20_000)]
    return () => timers.forEach(clearTimeout)
  }, [loading])

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
      {loading && (
        <p role="status" className={styles.progress}>
          {STEPS[step]}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {screen && !loading && <Result screen={screen} onClose={() => setScreen(null)} />}
    </section>
  )
}

function Result({ screen, onClose }: { screen: Screen; onClose: () => void }) {
  const picks = [...screen.picks].sort((a, b) => VERDICT[a.verdict].rank - VERDICT[b.verdict].rank || (b.rs ?? -1) - (a.rs ?? -1))
  const buys = picks.filter((p) => p.verdict === 'buy').length
  const inList = picks.filter((p) => p.passedCount >= 7).length
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Risultato Finviz</h2>
          <p role="status" className={styles.summary}>
            {picks.length === 0
              ? `Finviz ha trovato ${screen.total} titoli, ma nessuno passa anche i controlli su media a 50 giorni e distanza da massimi e minimi.`
              : buys > 0
                ? `${buys} ${buys === 1 ? 'titolo si può comprare' : 'titoli si possono comprare'} su ${picks.length} che passano i controlli.`
                : `Nessun titolo da comprare adesso: ${picks.length} passano i controlli, vedi sotto cosa aspettare.`}
          </p>
          <p className={styles.counts}>
            Finviz ne ha trovati {screen.total}, {screen.passedTechnical} passano i controlli su media a 50 giorni e distanza da massimi e minimi
            {inList > 0 ? `; ${inList} con almeno 7 criteri su 8 sono in elenco qui sotto, con l’etichetta Finviz` : ''}.
            {screen.truncated ? ' Letti solo i primi risultati: la lista completa è più lunga.' : ''}
          </p>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Chiudi il risultato">
          ×
        </button>
      </header>
      {picks.length > 0 && (
        <ul className={styles.list}>
          {picks.map((p) => {
            const tone = VERDICT[p.verdict].tone
            return (
              <li key={p.symbol} className={styles.item} data-tone={tone}>
                <div className={styles.head}>
                  <Link href={`/stock/${p.symbol}#minervini`} className={styles.symbol}>
                    {p.symbol}
                  </Link>
                  <span className={styles.chip} data-tone={tone}>
                    {p.label}
                  </span>
                  <span className={styles.meta}>
                    {p.passedCount}/8 criteri, {fmtPrice(p.price)}
                    {p.rs !== null ? `, RS ${fmtNum(p.rs, 0)}` : ''}
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
  )
}
