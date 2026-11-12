'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
      <button type="button" onClick={handleClick} disabled={removing}>
        Remove
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  )
}
