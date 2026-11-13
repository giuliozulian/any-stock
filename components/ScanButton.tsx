'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './ScanButton.module.css'

export function ScanButton() {
  const router = useRouter()
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setScanning(true)
    setError(null)
    try {
      const res = await fetch('/api/discover', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Scansione falliquita' }))
        setError(data.error ?? 'Scansione falliquita')
        return
      }
      router.refresh()
    } catch {
      setError('Scansione falliquita')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <button type="button" onClick={handleClick} disabled={scanning} className={styles.button}>
        {scanning ? 'Scansione in corso, può richiedere fino a un minuto…' : 'Scansiona ora'}
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
