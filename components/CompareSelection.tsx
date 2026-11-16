'use client'

import { createContext, useContext, useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './CompareSelection.module.css'

interface CompareContextValue {
  selected: Set<string>
  toggle: (symbol: string) => void
  clear: () => void
  maxCount: number
}

const CompareContext = createContext<CompareContextValue | null>(null)

export function CompareSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggle(symbol: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
  }

  const clear = () => setSelected(new Set())

  return <CompareContext.Provider value={{ selected, toggle, clear, maxCount: 4 }}>{children}</CompareContext.Provider>
}

function useCompareSelection() {
  const ctx = useContext(CompareContext)
  if (!ctx) throw new Error('CompareCheckbox/CompareBar must be used inside CompareSelectionProvider')
  return ctx
}

export function CompareCheckbox({ symbol }: { symbol: string }) {
  const { selected, toggle, maxCount } = useCompareSelection()
  const checked = selected.has(symbol)
  const disabled = !checked && selected.size >= maxCount
  return (
    <input
      type="checkbox"
      className={styles.checkbox}
      aria-label={symbol}
      checked={checked}
      disabled={disabled}
      title={disabled ? `Massimo ${maxCount} titoli` : 'Aggiungi al confronto'}
      onChange={() => toggle(symbol)}
    />
  )
}

export function CompareBar({ maxCount }: { maxCount: number }) {
  const { selected, toggle, clear } = useCompareSelection()
  const router = useRouter()

  if (selected.size === 0) return null

  const symbols = [...selected]
  const missing = 2 - selected.size

  return (
    <div className={styles.bar} role="toolbar" aria-label="Confronto titoli">
      <ul className={styles.chips}>
        {symbols.map((symbol) => (
          <li key={symbol}>
            <button type="button" className={styles.chip} onClick={() => toggle(symbol)} aria-label={`Rimuovi ${symbol} dal confronto`}>
              {symbol}
              <span aria-hidden="true" className={styles.chipX}>×</span>
            </button>
          </li>
        ))}
      </ul>
      <span className={styles.hint} aria-live="polite">
        {missing > 0 ? 'Scegline un altro' : `${selected.size} di ${maxCount}`}
      </span>
      <button type="button" className={styles.clear} onClick={clear}>
        Annulla
      </button>
      <button
        type="button"
        className={styles.button}
        disabled={selected.size < 2}
        onClick={() => router.push(`/confronta?symbols=${symbols.join(',')}`)}
      >
        Confronta
      </button>
    </div>
  )
}
