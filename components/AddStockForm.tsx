'use client'

import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import styles from './AddStockForm.module.css'

interface Suggestion {
  symbol: string
  description: string
  type: string
}

export function AddStockForm() {
  const router = useRouter()
  const [symbol, setSymbol] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const hasQuery = symbol.trim().length > 0
  const [active, setActive] = useState(-1)
  const listId = useId()

  useEffect(() => {
    const q = symbol.trim()
    if (q.length < 1) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        if (!res.ok) return
        const data = (await res.json()) as { results?: Suggestion[] }
        setSuggestions(data.results ?? [])
        setActive(-1)
      } catch {
        // aborted or offline: keep the previous suggestions
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [symbol])

  function pick(s: Suggestion) {
    setOpen(false)
    setSymbol('')
    router.push(`/stock/${encodeURIComponent(s.symbol)}`)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || !hasQuery || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(suggestions[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

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
    <div style={{ position: 'relative' }} className={styles.wrap}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          value={symbol}
          onChange={(e) => {
            setSymbol(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder="Cerca un titolo, es. AAPL o Apple"
          aria-label="Cerca un titolo"
          role="combobox"
          aria-expanded={open && hasQuery && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={submitting}
          className={styles.input}
        />
        <button type="submit" disabled={submitting || !symbol.trim()} className={styles.submit}>
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </form>
      {open && hasQuery && suggestions.length > 0 && (
        <ul id={listId} role="listbox" className={styles.suggestions}>
          {suggestions.map((s, i) => (
            <li key={s.symbol} role="option" aria-selected={i === active} className={`${styles.option} ${i === active ? styles.optionActive : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(s) }}>
              <span className={styles.optionSymbol}>{s.symbol}</span>
              <span className={styles.optionName}>{s.description}</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
