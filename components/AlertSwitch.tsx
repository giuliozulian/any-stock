'use client'

import { useRef, useState } from 'react'
import { EMAIL_NOT_READY } from '@/components/AlertBell'
import { EnvelopeIcon } from '@/components/EnvelopeIcon'
import { InfoTip } from '@/components/InfoTip'
import styles from './AlertSwitch.module.css'

export function AlertSwitch({ enabled: initial, emailReady }: { enabled: boolean; emailReady: boolean }) {
  const [enabled, setEnabled] = useState(initial)
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)

  async function toggle() {
    const next = !enabled
    const mine = ++latest.current
    setEnabled(next)
    setFailed(false)
    try {
      const res = await fetch('/api/scanner/alerts/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newEntrants: next }) })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      if (mine === latest.current) {
        setEnabled(!next)
        setFailed(true)
      }
    }
  }

  return (
    <span className={styles.wrap}>
      <button type="button" role="switch" aria-checked={enabled} className={styles.switch} title={emailReady ? undefined : EMAIL_NOT_READY} disabled={!emailReady} onClick={toggle}>
        <EnvelopeIcon />
        <span>Avvisami dei nuovi 8 su 8</span>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
      </button>
      <InfoTip label="Come funziona l’avviso sui nuovi 8 su 8" source="Scansione serale dell’app">
        Quando è attivo, ricevi una email con i titoli entrati negli 8 su 8 dall’ultima volta. La scansione parte da sola ogni sera dopo la chiusura del mercato USA; puoi sempre lanciarla a mano.
      </InfoTip>
      {failed && (
        <span role="status" className={styles.error}>
          Non sono riuscito a salvare l’impostazione.
        </span>
      )}
    </span>
  )
}
