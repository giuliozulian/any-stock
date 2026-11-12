'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import styles from './AddStockForm.module.css'

export function AddStockForm() {
  const router = useRouter()
  const [symbol, setSymbol] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })

      if (!res.ok) {
        let message = 'Failed to add symbol'
        try {
          const data = await res.json()
          message = data.error ?? message
        } catch {
          // non-JSON error body; keep the generic message
        }
        setError(message)
        return
      }

      setSymbol('')
      router.refresh()
    } catch {
      setError('Failed to add symbol')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Add a symbol"
          disabled={submitting}
          className={styles.input}
        />
        <button type="submit" disabled={submitting || !symbol.trim()} className={styles.submit}>
          Add
        </button>
      </form>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
