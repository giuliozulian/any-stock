'use client'

import { useRef, useState } from 'react'
import { EnvelopeIcon } from '@/components/EnvelopeIcon'
import styles from './AlertBell.module.css'

export const EMAIL_NOT_READY = 'Per ricevere le email imposta ALERT_EMAIL_TO e SMTP_HOST (oppure RESEND_API_KEY).'

export function AlertBell({ symbol, armed: initial, emailReady }: { symbol: string; armed: boolean; emailReady: boolean }) {
  const [armed, setArmed] = useState(initial)
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)

  async function toggle() {
    const next = !armed
    const mine = ++latest.current
    setArmed(next)
    setFailed(false)
    try {
      const res = await fetch(`/api/scanner/alerts/${encodeURIComponent(symbol)}`, { method: next ? 'POST' : 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      // Only the newest click may undo itself: an old request failing late must not overwrite a later choice.
      if (mine === latest.current) {
        setArmed(!next)
        setFailed(true)
      }
    }
  }

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.bell}
        aria-pressed={armed}
        aria-label={armed ? `Avviso attivo per ${symbol}, clicca per disattivarlo` : `Avvisami per email quando ${symbol} arriva a 8 su 8`}
        title={emailReady ? undefined : EMAIL_NOT_READY}
        disabled={!emailReady}
        onClick={toggle}
      >
        <EnvelopeIcon />
      </button>
      {failed && (
        <span role="status" className={styles.error}>
          Non sono riuscito ad aggiornare l’avviso.
        </span>
      )}
    </span>
  )
}
