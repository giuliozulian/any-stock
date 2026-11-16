'use client'

import { useState } from 'react'
import Link from 'next/link'
import { InfoTip } from './InfoTip'
import styles from './CandidateCard.module.css'

export interface CandidateCardData {
  symbol: string
  name: string
  market: 'US' | 'IT'
  score: number
  momentumScore: number
  fundamentalsScore: number
  insiderScore: number
  reason: string
  aiVerdict?: 'solid' | 'caution' | null
  aiNote?: string | null
  partial: boolean
  source: string
}

const PILLARS = [{ label: 'Andamento' }, { label: 'Conti' }, { label: 'Insider' }]

export function CandidateCard({ candidate }: { candidate: CandidateCardData }) {
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (hidden) return null

  const [headline, ...allDetails] = candidate.reason.split('\n')
  const details = allDetails.slice(0, PILLARS.length)
  const scores = [candidate.momentumScore, candidate.fundamentalsScore, candidate.insiderScore]

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
      setHidden(true)
    } catch {
      setError('Impossibile aggiungere il titolo')
    } finally {
      setBusy(false)
    }
  }

  async function dismiss() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/discover/${candidate.symbol}`, { method: 'PATCH' })
      if (!res.ok) {
        setError('Impossibile scartare il candidato')
        return
      }
      setHidden(true)
    } catch {
      setError('Impossibile scartare il candidato')
    } finally {
      setBusy(false)
    }
  }

  const tier = candidate.score >= 65 ? styles.tierHigh : candidate.score >= 40 ? styles.tierMid : styles.tierLow
  const visibleScores = candidate.market === 'IT' ? [0, 1] : [0, 1, 2]

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
            <InfoTip label="Come è calcolato il punteggio" source="Yahoo Finance, Finnhub, SEC EDGAR, STOCK Act" formula="media di Andamento, Conti e Insider (solo Andamento e Conti per l'Italia)">
              Da 0 a 100: più è alto, più il titolo merita un approfondimento. Non è un consiglio d'acquisto.
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
            {candidate.partial && <span className={styles.partialBadge}>Dati incompleti<InfoTip label="Dati incompleti" source="Finnhub, Yahoo Finance">Alcune fonti non hanno risposto per questo titolo: il punteggio potrebbe essere sottostimato.</InfoTip></span>}
            {candidate.source.split(',').includes('edgar-form4-cluster') && <span className={styles.clusterBadge}>Più insider comprano<InfoTip label="Più insider comprano" source="SEC EDGAR (Form 4)">Più dirigenti o grandi azionisti della società hanno comprato azioni nello stesso periodo.</InfoTip></span>}
          </div>
          <p className={styles.reason}>{headline}</p>
          {candidate.aiVerdict && candidate.aiNote && (
            <p className={styles.aiReview} data-verdict={candidate.aiVerdict}>
              <span className={styles.aiTag}>IA</span>
              <strong>{candidate.aiVerdict === 'solid' ? 'Segnali coerenti.' : 'Da prendere con cautela.'}</strong> {candidate.aiNote}
            </p>
          )}
          {details.length > 0 && (
            <ul className={styles.meters}>
              {visibleScores.map((i) => (
                <li key={PILLARS[i].label} className={styles.meter}>
                  <span className={styles.meterLabel}>{PILLARS[i].label}</span>
                  <span className={styles.meterBar} aria-hidden="true">
                    <span style={{ width: `${scores[i]}%` }} />
                  </span>
                  <span className={styles.meterScore}>{scores[i]}/100</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {details.length > 0 && (
        <details className={styles.why}>
          <summary className={styles.whySummary}>Perché questo punteggio</summary>
          <dl className={styles.whyList}>
            {details.map((text, i) => (
              <div key={PILLARS[i].label} className={styles.whyItem}>
                <dt>{PILLARS[i].label}</dt>
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
        <button type="button" onClick={dismiss} disabled={busy} className={styles.dismissButton}>
          Scarta
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
