'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './QuickAdd.module.css'

export function QuickAdd({ symbols }: { symbols: string[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function add(symbol: string) {
    setPending(symbol)
    setError(null)
    try {
      const res = await fetch('/api/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })
      if (!res.ok) {
        setError(`Non riesco ad aggiungere ${symbol}. Riprova.`)
        return
      }
      router.refresh()
    } catch {
      setError(`Non riesco ad aggiungere ${symbol}. Riprova.`)
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <ul className={styles.list}>
        {symbols.map((s) => (
          <li key={s}>
            <button type="button" className={styles.chip} disabled={pending !== null} onClick={() => add(s)}>
              {pending === s ? `Aggiungo ${s}…` : `Aggiungi ${s}`}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
