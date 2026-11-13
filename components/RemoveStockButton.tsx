'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './ghost-button.module.css'

export function RemoveStockButton({ symbol }: { symbol: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  async function handleClick() {
    setRemoving(true)
    setError(null)

    try {
      const res = await fetch(`/api/stocks/${symbol}`, { method: 'DELETE' })

      if (!res.ok) {
        let message = 'Failed to remove stock'
        try {
          const data = await res.json()
          message = data.error ?? message
        } catch {
          // non-JSON error body; keep the generic message
        }
        setError(message)
        return
      }

      router.refresh()
    } catch {
      setError('Failed to remove stock')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={removing}
        className={styles.trash}
        aria-label={`Rimuovi ${symbol} dalla watchlist`}
        title="Rimuovi"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </>
  )
}
