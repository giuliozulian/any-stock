'use client'

import { useEffect, useId, useRef, useState } from 'react'
import styles from './MemberName.module.css'

export interface MemberCard {
  name: string
  chamber: string
  state: string
  party: string
  role: string
  influence: string
  note: string
  purchases: number
  tickers: number
  avgPerfPct: number | null
}

const INFLUENCE_HELP: Record<string, string> = {
  alta: 'Influenza alta: il suo ruolo può dargli visibilità su decisioni che muovono i mercati, quindi i suoi acquisti meritano più attenzione.',
  media: 'Influenza media: partecipa a commissioni rilevanti ma senza un ruolo decisivo.',
  bassa: 'Influenza bassa: poco legato ai settori che compra, i suoi acquisti sono più simili a quelli di un normale investitore.',
}

export function MemberName({ card }: { card: MemberCard }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const chamber = card.chamber === 'senate' ? 'Senato' : card.chamber === 'house' ? 'Camera' : card.chamber
  const identity = [card.party, chamber, card.state].filter(Boolean).join(' · ')

  return (
    <span className={`${styles.wrap} ${open ? styles.open : ''}`} ref={ref}>
      <button type="button" className={styles.name} aria-describedby={id} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {card.name}
      </button>
      <span role="tooltip" id={id} className={styles.bubble}>
        <strong>{card.name}</strong>
        <span className={styles.muted}>{identity}</span>
        {card.role && <span>{card.role}</span>}
        {card.influence && (
          <span>
            <span className={styles.badge} data-level={card.influence}>
              Influenza {card.influence}
            </span>{' '}
            {INFLUENCE_HELP[card.influence]}
          </span>
        )}
        {card.note && <span>{card.note}</span>}
        <span className={styles.record}>
          Nei dati recenti: {card.purchases} {card.purchases === 1 ? 'acquisto' : 'acquisti'} su {card.tickers} {card.tickers === 1 ? 'titolo' : 'titoli'}
          {card.avgPerfPct !== null && (
            <>
              ; rendimento medio {card.avgPerfPct >= 0 ? '+' : '−'}
              {Math.abs(card.avgPerfPct).toFixed(1)}% da quando ha comprato
            </>
          )}
          .
        </span>
        <span className={styles.disclaimer}>Profilo generato dall&apos;AI, verificalo. Per dare peso a un politico guarda il suo rendimento nel tempo, non il nome.</span>
      </span>
    </span>
  )
}
