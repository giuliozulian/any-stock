'use client'

import { useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import styles from './StockTabs.module.css'

export interface StockTab {
  id: string
  label: string
  content: ReactNode
}

function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function StockTabs({ tabs }: { tabs: StockTab[] }) {
  const base = useId()
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => '',
  )
  const active = tabs.some((t) => t.id === hash) ? hash : tabs[0].id
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function select(id: string) {
    history.replaceState(null, '', `#${id}`)
    window.dispatchEvent(new Event('hashchange'))
  }

  function onKey(e: KeyboardEvent, index: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = tabs[(index + step + tabs.length) % tabs.length]
    select(next.id)
    refs.current[next.id]?.focus()
  }

  return (
    <div className={styles.tabs}>
      <div role="tablist" aria-label="Sezioni della scheda" className={styles.list}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el
            }}
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            className={styles.tab}
            onClick={() => select(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`} hidden={active !== t.id} className={styles.panel}>
          {t.content}
        </div>
      ))}
    </div>
  )
}
