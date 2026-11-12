'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

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
    <form onSubmit={handleSubmit}>
      <input
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        placeholder="Symbol (e.g. AAPL)"
        disabled={submitting}
      />
      <button type="submit" disabled={submitting || !symbol.trim()}>
        Add
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
