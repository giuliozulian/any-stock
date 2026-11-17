'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './ScanButton.module.css'

interface Progress {
  step: string
  done?: number
  total?: number
}

export function ScanButton() {
  const router = useRouter()
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setScanning(true)
    setProgress({ step: 'Avvio la ricerca' })
    setError(null)
    try {
      const res = await fetch('/api/discover', { method: 'POST', headers: { Accept: 'application/x-ndjson' } })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'La ricerca non è riuscita' }))
        setError(data.error ?? 'La ricerca non è riuscita')
        return
      }
      if (!res.body) {
        router.refresh()
        return
      }
      // One JSON line per step, then {result} or {error}.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let failed = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines.filter(Boolean)) {
          const msg = JSON.parse(line) as { step?: string; done?: number; total?: number; error?: string }
          if (msg.error) {
            failed = true
            setError(msg.error)
          } else if (msg.step) setProgress({ step: msg.step, done: msg.done, total: msg.total })
        }
      }
      if (!failed) router.refresh()
    } catch {
      setError('La ricerca non è riuscita')
    } finally {
      setScanning(false)
      setProgress(null)
    }
  }

  const counter = progress?.total ? ` (${progress.done ?? 0}/${progress.total})` : ''
  return (
    <div className={styles.wrap}>
      <button type="button" onClick={handleClick} disabled={scanning} className={styles.button}>
        {scanning ? 'Ricerca in corso…' : 'Scansiona ora'}
      </button>
      {scanning && progress && (
        <p role="status" className={styles.progress}>
          {progress.step}
          {counter}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
