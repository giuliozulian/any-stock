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

    const res = await fetch('/api/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    })

    setSubmitting(false)

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to add symbol')
      return
    }

    setSymbol('')
    router.refresh()
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
