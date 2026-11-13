'use client'

import { createContext, useContext, useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './CompareSelection.module.css'

interface CompareContextValue {
  selected: Set<string>
  toggle: (symbol: string) => void
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

  return <CompareContext.Provider value={{ selected, toggle, maxCount: 4 }}>{children}</CompareContext.Provider>
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
      title={disabled ? `Massimo ${maxCount} titoli` : undefined}
      onChange={() => toggle(symbol)}
    />
  )
}

export function CompareBar({ maxCount }: { maxCount: number }) {
  const { selected } = useCompareSelection()
  const router = useRouter()

  if (selected.size === 0) return null

  return (
    <div className={styles.bar} role="toolbar" aria-label="Confronto titoli">
      <span className={styles.count}>
        {selected.size} selezionat{selected.size === 1 ? 'o' : 'i'}
      </span>
      <button
        type="button"
        className={styles.button}
        disabled={selected.size < 2}
        onClick={() => router.push(`/confronta?symbols=${[...selected].join(',')}`)}
      >
        Confronta
      </button>
    </div>
  )
}
