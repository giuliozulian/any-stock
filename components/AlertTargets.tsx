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
}

const money = (n: number) => `$${n.toFixed(2)}`

export function AlertTargets({ symbol, entryPrice, sellPrice, entryTriggered, sellTriggered }: Props) {
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
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {hasTargets ? (
          <>
            {entryPrice !== null && (
              <span className={entryTriggered ? styles.hit : undefined}>
                Ingresso ≤ {money(entryPrice)}
                {entryTriggered && ' · raggiunto'}
              </span>
            )}
            {sellPrice !== null && (
              <span className={sellTriggered ? styles.hit : undefined}>
                Vendita ≥ {money(sellPrice)}
                {sellTriggered && ' · raggiunto'}
              </span>
            )}
          </>
        ) : (
          <span>Imposta avvisi di prezzo</span>
        )}
      </button>
      {open && (
        <form className={styles.form} onSubmit={save}>
          <label className={styles.field}>
            <span>Compra se scende a ($)</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="es. 150" />
          </label>
          <label className={styles.field}>
            <span>Vendi se sale a ($)</span>
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
