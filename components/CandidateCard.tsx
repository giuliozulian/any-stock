'use client'

import { useState } from 'react'
import Link from 'next/link'
import { InfoTip } from './InfoTip'
import { Sparkline } from './Sparkline'
import styles from './CandidateCard.module.css'

export interface CandidateCardData {
  symbol: string
  name: string
  market: 'US' | 'IT'
  score: number
  // Column names are historical: momentumScore is "Momento", fundamentalsScore "Qualità", insiderScore "Persone". -1 means not measured.
  momentumScore: number
  fundamentalsScore: number
  insiderScore: number
  reason: string
  aiVerdict?: 'solid' | 'caution' | null
  aiNote?: string | null
  partial: boolean
  source: string
  price?: number | null
  changePct?: number | null
  marketCap?: number | null
  flags?: string[]
  spark?: number[] | null
  isNew?: boolean
  // Score now minus the score at the previous scan; null when it is the first time.
  scoreDelta?: number | null
  // Criteria the Minervini scan passed out of 8, when the stock is in its universe.
  scannerPassed?: number | null
}

// Order of the pillars on the card, and of the detail lines in `reason`.
const PILLARS = ['Persone', 'Qualità', 'Momento'] as const

const SOURCE_LABEL: Record<string, string> = {
  congress: 'Comprato da politici USA',
  'earnings-beat': 'Utili sopra le attese',
  ipo: 'IPO recente',
  peer: 'Simile a un tuo titolo',
  'movers-it': 'Movimento forte',
}

const money = (n: number) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)} mila mld` : n >= 1e9 ? `${(n / 1e9).toFixed(1)} mld` : `${Math.round(n / 1e6)} mln`)

type Hidden = null | { days: number | null }

export function CandidateCard({ candidate }: { candidate: CandidateCardData }) {
  const [added, setAdded] = useState(false)
  const [hidden, setHidden] = useState<Hidden>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (added) return null

  if (hidden) {
    return (
      <p className={styles.hiddenNote} role="status">
        {candidate.symbol} nascosto {hidden.days === null ? 'per sempre' : `per ${hidden.days} giorni`}.{' '}
        <button
          type="button"
          className={styles.undo}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const res = await fetch(`/api/discover/${candidate.symbol}`, { method: 'DELETE' })
              if (res.ok) setHidden(null)
              else setError('Non riesco ad annullare')
            } catch {
              setError('Non riesco ad annullare')
            } finally {
              setBusy(false)
            }
          }}
        >
          Annulla
        </button>
        {error && <span role="alert"> {error}</span>}
      </p>
    )
  }

  const [headline, ...allDetails] = candidate.reason.split('\n')
  const details = allDetails.slice(0, PILLARS.length)
  const scores = [candidate.insiderScore, candidate.fundamentalsScore, candidate.momentumScore]
  const sources = candidate.source.split(',')

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: candidate.symbol }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Impossibile aggiungere il titolo' }))
        setError(data.error ?? 'Impossibile aggiungere il titolo')
        return
      }
      setAdded(true)
    } catch {
      setError('Impossibile aggiungere il titolo')
    } finally {
      setBusy(false)
    }
  }

  async function hide(days: number | null) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/discover/${candidate.symbol}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      })
      if (!res.ok) {
        setError('Impossibile nascondere il candidato')
        return
      }
      setHidden({ days })
    } catch {
      setError('Impossibile nascondere il candidato')
    } finally {
      setBusy(false)
    }
  }

  const tier = candidate.score >= 65 ? styles.tierHigh : candidate.score >= 40 ? styles.tierMid : styles.tierLow
  const delta = candidate.scoreDelta ?? null

  return (
    <article className={`${styles.card} ${tier}`}>
      <div className={styles.top}>
        <div className={styles.scoreBox}>
          <div className={styles.ringWrap}>
            <div className={styles.ring} style={{ '--pct': `${candidate.score}%` } as React.CSSProperties} />
            <span className={styles.scoreValue}>{candidate.score}</span>
          </div>
          <span className={styles.scoreLabel}>
            Punteggio
            <InfoTip label="Come è calcolato il punteggio" source="Yahoo Finance, Finnhub, SEC EDGAR, STOCK Act" formula="media di Persone, Qualità e Momento (solo Qualità e Momento per l'Italia); un pilastro non misurabile resta fuori dalla media">
              Da 0 a 100: più è alto, più il titolo merita un approfondimento. Non è un consiglio d&apos;acquisto.
            </InfoTip>
          </span>
        </div>
        <div className={styles.body}>
          <div className={styles.head}>
            <Link href={`/stock/${encodeURIComponent(candidate.symbol)}`} className={styles.titleLink}>
              <span className={styles.symbol}>{candidate.symbol}</span>
              <span className={styles.name}>{candidate.name}</span>
            </Link>
            <span className={`${styles.marketBadge} ${candidate.market === 'US' ? styles.us : styles.it}`}>{candidate.market === 'US' ? 'USA' : 'Italia'}</span>
            {candidate.isNew && <span className={styles.newBadge}>Nuovo</span>}
            {delta !== null && Math.abs(delta) >= 5 && (
              <span className={delta > 0 ? styles.up : styles.down} title="Variazione del punteggio rispetto all'ultimo scan">
                {delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(delta))}
              </span>
            )}
          </div>
          <p className={styles.reason}>{headline}</p>
        </div>
        <div className={styles.market}>
          {candidate.price != null && (
            <span className={styles.price}>
              {candidate.market === 'IT' ? '€' : '$'}
              {candidate.price.toFixed(2)}
              {candidate.changePct != null && <span className={candidate.changePct >= 0 ? styles.gain : styles.loss}>{` ${candidate.changePct >= 0 ? '+' : '−'}${Math.abs(candidate.changePct).toFixed(1)}%`}</span>}
            </span>
          )}
          {candidate.marketCap != null && <span className={styles.cap}>cap. {money(candidate.marketCap)}</span>}
          {candidate.spark && <Sparkline values={candidate.spark} label={`Andamento degli ultimi 3 mesi di ${candidate.symbol}`} />}
        </div>
      </div>

      <ul className={styles.chips} aria-label="Come è arrivato qui e avvisi">
        {sources.map((s) =>
          s === 'edgar-form4-cluster' ? (
            <li key={s} className={styles.chip}>
              Più insider comprano
              <InfoTip label="Più insider comprano" source="SEC EDGAR (Form 4)">
                Più dirigenti o grandi azionisti della società hanno comprato azioni nello stesso periodo.
              </InfoTip>
            </li>
          ) : SOURCE_LABEL[s] ? (
            <li key={s} className={styles.chip}>
              {SOURCE_LABEL[s]}
            </li>
          ) : null
        )}
        {candidate.scannerPassed != null && (
          <li className={`${styles.chip} ${candidate.scannerPassed >= 7 ? styles.chipGood : ''}`}>
            <Link href="/scanner">Minervini SCAN: {candidate.scannerPassed}/8 criteri</Link>
          </li>
        )}
        {(candidate.flags ?? []).map((f) => (
          <li key={f} className={`${styles.chip} ${styles.chipWarn}`}>
            {f}
          </li>
        ))}
        {candidate.partial && (
          <li className={`${styles.chip} ${styles.chipWarn}`}>
            Dati incompleti
            <InfoTip label="Dati incompleti" source="Finnhub, Yahoo Finance">
              Alcune fonti non hanno risposto per questo titolo: il punteggio potrebbe essere sottostimato.
            </InfoTip>
          </li>
        )}
      </ul>

      {candidate.aiVerdict && candidate.aiNote && (
        <p className={styles.aiReview} data-verdict={candidate.aiVerdict}>
          <span className={styles.aiTag}>IA</span>
          <strong>{candidate.aiVerdict === 'solid' ? 'Segnali coerenti.' : 'Da prendere con cautela.'}</strong> {candidate.aiNote}
        </p>
      )}

      <ul className={styles.meters}>
        {PILLARS.map((label, i) => (
          <li key={label} className={styles.meter}>
            <span className={styles.meterLabel}>{label}</span>
            <span className={styles.meterBar} aria-hidden="true">
              <span style={{ width: `${Math.max(scores[i], 0)}%` }} />
            </span>
            <span className={styles.meterScore}>{scores[i] < 0 ? 'n.d.' : `${scores[i]}/100`}</span>
          </li>
        ))}
      </ul>

      {details.length > 0 && (
        <details className={styles.why}>
          <summary className={styles.whySummary}>Perché questo punteggio</summary>
          <dl className={styles.whyList}>
            {details.map((text, i) => (
              <div key={PILLARS[i]} className={styles.whyItem}>
                <dt>{PILLARS[i]}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <div className={styles.actions}>
        <button type="button" onClick={add} disabled={busy} className={styles.addButton}>
          Aggiungi alla watchlist
        </button>
        <button type="button" onClick={() => hide(30)} disabled={busy} className={styles.dismissButton}>
          Nascondi 30 giorni
        </button>
        <button type="button" onClick={() => hide(null)} disabled={busy} className={styles.dismissButton}>
          Mai più
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </article>
  )
}
