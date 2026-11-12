'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './ghost-button.module.css'

export function RefreshButton({ symbol }: { symbol: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function handleClick() {
    setRefreshing(true)
    setError(null)

    try {
      const res = await fetch(`/api/stocks/${symbol}/refresh`, { method: 'POST' })

      if (!res.ok) {
        let message = 'Failed to refresh stock'
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
      setError('Failed to refresh stock')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={refreshing} className={styles.button}>
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </>
  )
}
