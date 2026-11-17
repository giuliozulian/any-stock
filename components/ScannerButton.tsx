'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './ScannerButton.module.css'

interface Progress {
  cursor: number
  total: number
}

export function ScannerButton({ resumable, lockedLabel = null }: { resumable: boolean; lockedLabel?: string | null }) {
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

  const locked = lockedLabel !== null && !canResume
  const percent = progress && progress.total > 0 ? Math.round((progress.cursor / progress.total) * 100) : 0

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <button type="button" onClick={run} disabled={running || locked} className={styles.button}>
          {running ? 'Scansione in corso…' : canResume ? 'Riprendi scansione' : 'Avvia scansione'}
        </button>
        {locked && !running && <p className={styles.note}>{lockedLabel}</p>}
        {running && progress && (
          <div className={styles.progress}>
            <progress value={progress.cursor} max={progress.total} aria-label="Avanzamento scansione" />
            <span className={styles.percent}>{percent}%</span>
            <span className={styles.note}>
              {progress.cursor} di {progress.total} titoli
            </span>
          </div>
        )}
      </div>
      {running ? (
        <p className={styles.hint}>Lascia aperta questa pagina: servono 2–4 minuti.</p>
      ) : (
        <p className={styles.hint}>
          Quando farla: a mercato USA chiuso, dopo le 22:30 ora italiana o la mattina dopo. A mercato aperto l’ultima barra è incompleta e il volume è parziale. I dati sono giornalieri: una volta al giorno basta.
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
