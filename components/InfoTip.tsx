'use client'

import { useEffect, useId, useRef, useState } from 'react'
import styles from './InfoTip.module.css'

export function InfoTip({
  label,
  source,
  formula,
  align = 'left',
  children,
}: {
  label: string
  source: string
  formula?: string
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span className={`${styles.tip} ${open ? styles.tipOpen : ''} ${align === 'right' ? styles.alignRight : ''}`} ref={ref}>
      <button
        type="button"
        className={styles.tipButton}
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      <span role="tooltip" id={id} className={styles.tipBubble}>
        {children}
        {formula && <span className={styles.tipFormula}>Formula: {formula}</span>}
        <span className={styles.tipSource}>Fonte: {source}</span>
      </span>
    </span>
  )
}
