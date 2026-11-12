'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './WatchStar.module.css'

export function WatchStar({ symbol, watched }: { symbol: string; watched: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      const res = await (watched
        ? fetch(`/api/stocks/${symbol}`, { method: 'DELETE' })
        : fetch('/api/stocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol }) }))
      if (!res.ok) {
        let message = watched ? 'Non riesco a toglierlo dalla watchlist' : 'Non riesco ad aggiungerlo alla watchlist'
        try {
          const data = await res.json()
          if (res.status !== 409) message = data.error ?? message
        } catch {
          // keep the generic message
        }
        if (res.status !== 409) {
          setError(message)
          return
        }
      }
      router.refresh()
    } catch {
      setError('Operazione non riuscita, riprova')
    } finally {
      setBusy(false)
    }
  }

  const label = watched ? 'Togli dalla watchlist' : 'Aggiungi alla watchlist'
  return (
    <span className={styles.wrap}>
      <button type="button" onClick={toggle} disabled={busy} aria-pressed={watched} aria-label={label} title={label} className={`${styles.star} ${watched ? styles.on : ''}`}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9z" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        <span>{busy ? (watched ? 'Tolgo…' : 'Aggiungo…') : watched ? 'In watchlist' : 'Aggiungi alla watchlist'}</span>
      </button>
      {error && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </span>
  )
}
