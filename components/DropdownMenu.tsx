'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './DropdownMenu.module.css'

// A button that opens a panel. The panel's content is rendered by the server (links), so a choice is just a navigation: the panel closes when a link inside it is followed, on a click outside, or with Escape.
export function DropdownMenu({ label, count = 0, active = false, children }: { label: string; count?: number; active?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div
      ref={root}
      className={styles.root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false)
          trigger.current?.focus()
        }
      }}
    >
      <button ref={trigger} type="button" className={styles.trigger} data-active={active || count > 0 || undefined} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        {label}
        {count > 0 && <span className={styles.count}>{count}</span>}
        <svg className={styles.chevron} viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className={styles.panel} onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}
