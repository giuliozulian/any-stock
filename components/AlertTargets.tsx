'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './AlertTargets.module.css'

interface Props {
  symbol: string
  entryPrice: number | null
  sellPrice: number | null
  entryTriggered: boolean
  sellTriggered: boolean
  // Latest price, to say how far each target is.
  price?: number | null
}

const money = (n: number) => `$${n.toFixed(2)}`
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`

// One target as a chip: which way the price must move, what it is called, the level, and how far from now (or that it was reached).
function Target({ kind, level, reached, price }: { kind: 'entry' | 'sell'; level: number; reached: boolean; price: number | null }) {
  const distance = price && price > 0 ? ((level - price) / price) * 100 : null
  return (
    <span className={`${styles.target} ${reached ? styles.targetHit : ''}`}>
      <span className={kind === 'entry' ? styles.down : styles.up} aria-hidden="true">
        {kind === 'entry' ? '↓' : '↑'}
      </span>
      <span className={styles.targetLabel}>{kind === 'entry' ? 'Ingresso' : 'Uscita'}</span>
      <strong className={styles.targetLevel}>{money(level)}</strong>
      {reached ? <span className={styles.targetNote}>raggiunto</span> : distance !== null && <span className={styles.targetNote}>a {signed(distance)}</span>}
    </span>
  )
}

export function AlertTargets({ symbol, entryPrice, sellPrice, entryTriggered, sellTriggered, price = null }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [entry, setEntry] = useState(entryPrice?.toString() ?? '')
  const [sell, setSell] = useState(sellPrice?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/stocks/${symbol}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryPrice: entry.trim() === '' ? null : Number(entry), sellPrice: sell.trim() === '' ? null : Number(sell) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Salvataggio non riuscito')
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError('Salvataggio non riuscito')
    } finally {
      setSaving(false)
    }
  }

  const hasTargets = entryPrice !== null || sellPrice !== null

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.box} ${hasTargets ? styles.boxSet : ''}`}
        aria-expanded={open}
        aria-label={hasTargets ? 'Modifica gli avvisi di prezzo' : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <svg className={styles.bell} viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M8 2.2a3.8 3.8 0 0 0-3.8 3.8v2.2L3 10.4v.6h10v-.6l-1.2-2.2V6A3.8 3.8 0 0 0 8 2.2ZM6.6 12.4a1.5 1.5 0 0 0 2.8 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {hasTargets ? (
          <>
            {entryPrice !== null && <Target kind="entry" level={entryPrice} reached={entryTriggered} price={price} />}
            {sellPrice !== null && <Target kind="sell" level={sellPrice} reached={sellTriggered} price={price} />}
            <span className={styles.edit}>
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="m10.8 3.2 2 2M3 13l.6-2.6 7.2-7.2 2 2-7.2 7.2L3 13Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Modifica
            </span>
          </>
        ) : (
          <span>Imposta avvisi di prezzo</span>
        )}
      </button>
      {open && (
        <form className={styles.form} onSubmit={save}>
          <label className={styles.field}>
            <span>Ingresso: compra se scende a ($)</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="es. 150" />
          </label>
          <label className={styles.field}>
            <span>Uscita: vendi se sale a ($)</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={sell} onChange={(e) => setSell(e.target.value)} placeholder="es. 200" />
          </label>
          <button type="submit" className={styles.save} disabled={saving}>
            {saving ? 'Salvo…' : 'Salva'}
          </button>
          <p className={styles.hint}>Ricevi una email quando il prezzo raggiunge la soglia. Lascia vuoto per togliere un avviso.</p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
