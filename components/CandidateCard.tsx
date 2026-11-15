'use client'

import { useState } from 'react'
import styles from './CandidateCard.module.css'

export interface CandidateCardData {
  symbol: string
  name: string
  market: 'US' | 'IT'
  score: number
  reason: string
  partial: boolean
  source: string
}

export function CandidateCard({ candidate }: { candidate: CandidateCardData }) {
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (hidden) return null

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

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={`${styles.marketBadge} ${candidate.market === 'US' ? styles.us : styles.it}`}>{candidate.market}</span>
        <span className={styles.symbol}>{candidate.symbol}</span>
        <span className={styles.name}>{candidate.name}</span>
        {candidate.partial && <span className={styles.partialBadge}>Dati parziali</span>}
        {candidate.source.split(',').includes('edgar-form4-cluster') && <span className={styles.clusterBadge}>Cluster insider</span>}
        <span className={styles.score}>{candidate.score}</span>
      </div>
      <p className={styles.reason}>{candidate.reason}</p>
      <div className={styles.actions}>
        <button type="button" onClick={add} disabled={busy} className={styles.addButton}>
          Aggiungi a watchlist
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
    </div>
  )
}
