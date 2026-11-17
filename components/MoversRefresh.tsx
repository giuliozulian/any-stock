'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import styles from '@/app/movimenti/movimenti.module.css'

const LIVE_REFRESH_MS = 60_000

// Reloads the server-rendered list on demand, and every minute while the exchange is open.
export function MoversRefresh({ live }: { live: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [auto, setAuto] = useState(true)

  useEffect(() => {
    if (!live || !auto) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') start(() => router.refresh())
    }, LIVE_REFRESH_MS)
    return () => clearInterval(id)
  }, [live, auto, router])

  return (
    <span className={styles.refresh}>
      <button type="button" className={styles.refreshButton} disabled={pending} onClick={() => start(() => router.refresh())}>
        {pending ? 'Aggiorno…' : 'Aggiorna'}
      </button>
      {live && (
        <label className={styles.autoLabel}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> ogni minuto
        </label>
      )}
    </span>
  )
}
