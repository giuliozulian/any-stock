'use client'

import styles from './SinceWatching.module.css'
import { InfoTip } from './InfoTip'
import { useLivePrice } from './live-quotes'

interface Props {
  symbol?: string
  addedAt: Date
  entryPrice: number
  currentPrice: number
}

export function SinceWatching({ symbol, addedAt, entryPrice, currentPrice: initialPrice }: Props) {
  const currentPrice = useLivePrice(symbol ?? null, initialPrice)
  const diff = currentPrice - entryPrice
  const pct = entryPrice > 0 ? (diff / entryPrice) * 100 : null
  const tone = diff > 0 ? styles.gain : diff < 0 ? styles.loss : styles.flat
  const sign = diff >= 0 ? '+' : '−'
  const dateLong = addedAt.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
  const fresh = diff === 0

  return (
    <section className={styles.band} aria-label="Andamento da quando lo segui">
      <div className={styles.when}>
        <p className={styles.label}>
          Lo segui dal
          <InfoTip
            label="Cos’è Da quando lo segui"
            source="data di aggiunta alla watchlist e prezzi salvati nel tuo database a ogni Refresh (prima rilevazione vs ultima)"
            formula="variazione = (prezzo attuale − prezzo al momento dell’aggiunta) ÷ prezzo al momento dell’aggiunta × 100"
          >
            <strong>Da quando lo segui</strong>
            <span>Quanto è cambiato il prezzo dal giorno in cui hai aggiunto il titolo alla watchlist, con il prezzo di allora e quello di oggi.</span>
            <span>Serve a vedere il tuo andamento personale, indipendentemente dai segnali. Non entra nel giudizio.</span>
          </InfoTip>
        </p>
        <p className={styles.date}>
          <time dateTime={addedAt.toISOString()}>{dateLong}</time>
        </p>
      </div>

      <div className={styles.prices}>
        <div>
          <p className={styles.label}>Prezzo allora</p>
          <p className={styles.price}>${entryPrice.toFixed(2)}</p>
        </div>
        <span className={styles.arrow} aria-hidden="true">→</span>
        <div>
          <p className={styles.label}>Prezzo oggi</p>
          <p className={styles.price}>${currentPrice.toFixed(2)}</p>
        </div>
      </div>

      <div className={`${styles.result} ${tone}`}>
        {pct === null || fresh ? (
          <p className={styles.fresh}>Appena aggiunto: premi Refresh nei prossimi giorni per vedere come va.</p>
        ) : (
          <>
            <p className={styles.pct}>
              {sign}
              {Math.abs(pct).toFixed(1)}%
            </p>
            <p className={styles.diff}>
              {sign}${Math.abs(diff).toFixed(2)} per azione
            </p>
          </>
        )}
      </div>
    </section>
  )
}
