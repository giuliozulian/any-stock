'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './ScannerButton.module.css'

interface Progress {
  cursor: number
  total: number
}

export function ScannerButton({ resumable }: { resumable: boolean }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canResume, setCanResume] = useState(resumable)

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const startRes = await fetch('/api/scanner', { method: 'POST' })
      const start = await startRes.json().catch(() => ({}))
      if (!startRes.ok) {
        setError(
          startRes.status === 429
            ? `Ultima scansione troppo recente: puoi rilanciarla dopo le ${new Date(start.retryAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.`
            : (start.error ?? 'Scansione fallita'),
        )
        return
      }
      setProgress({ cursor: start.cursor, total: start.total })
      let status: string = start.status
      while (status === 'running') {
        const res = await fetch('/api/scanner/step', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: start.runId }) })
        if (res.status === 409) break
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(body.error ?? 'Scansione fallita')
          setCanResume(true)
          return
        }
        setProgress({ cursor: body.cursor, total: body.total })
        status = body.status
      }
      setCanResume(false)
      router.refresh()
    } catch {
      setError('Scansione fallita')
      setCanResume(true)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <button type="button" onClick={run} disabled={running} className={styles.button}>
        {running ? 'Scansione in corso…' : canResume ? 'Riprendi scansione' : 'Avvia scansione'}
      </button>
      {running && progress && (
        <div className={styles.progress}>
          <progress value={progress.cursor} max={progress.total} aria-label="Avanzamento scansione" />
          <span>
            {progress.cursor} di {progress.total}
          </span>
          <span className={styles.hint}>Lascia aperta questa pagina: servono 2–4 minuti.</span>
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
