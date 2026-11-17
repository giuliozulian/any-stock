'use client'

import Link from 'next/link'
import { signedPct, useLiveQuotes } from './live-quotes'
import styles from './WatchlistSummary.module.css'

interface Item {
  symbol: string
  entryPrice: number | null
  price: number | null
}

export function WatchlistSummary({ items }: { items: Item[] }) {
  const live = useLiveQuotes(items.map((i) => i.symbol))
  const perf: { symbol: string; pct: number }[] = []
  for (const i of items) {
    const price = live[i.symbol]?.price ?? i.price
    if (!i.entryPrice || i.entryPrice <= 0 || price === null) continue
    perf.push({ symbol: i.symbol, pct: ((price - i.entryPrice) / i.entryPrice) * 100 })
  }
  const gaining = perf.filter((p) => p.pct > 0).length
  const losing = perf.filter((p) => p.pct < 0).length
  const flat = perf.length - gaining - losing
  const best = perf.length ? perf.reduce((a, b) => (b.pct > a.pct ? b : a)) : null
  const worst = perf.length ? perf.reduce((a, b) => (b.pct < a.pct ? b : a)) : null

  return (
    <section className={styles.summary} aria-label="Riepilogo watchlist">
      <div className={styles.count}>
        <span className={styles.countValue}>{items.length}</span>
        <span className={styles.countLabel}>{items.length === 1 ? 'titolo seguito' : 'titoli seguiti'}</span>
      </div>

      <div className={styles.split}>
        <p className={styles.splitText}>
          <span className={styles.gain}>{gaining} in guadagno</span>
          <span className={styles.loss}>{losing} in perdita</span>
        </p>
        <div
          className={styles.bar}
          role="img"
          aria-label={`Da quando li segui: ${gaining} in guadagno, ${losing} in perdita${flat ? `, ${flat} invariati` : ''}`}
        >
          {perf.length === 0 ? null : (
            <>
              <span className={styles.barGain} style={{ flexGrow: gaining }} />
              <span className={styles.barFlat} style={{ flexGrow: flat }} />
              <span className={styles.barLoss} style={{ flexGrow: losing }} />
            </>
          )}
        </div>
        <p className={styles.note}>Rispetto al prezzo di quando li hai aggiunti</p>
      </div>

      <dl className={styles.extremes}>
        <Extreme label="Il migliore" item={best} tone={styles.gain} />
        <Extreme label="Il peggiore" item={worst && worst !== best ? worst : null} tone={styles.loss} />
      </dl>
    </section>
  )
}

function Extreme({ label, item, tone }: { label: string; item: { symbol: string; pct: number } | null; tone: string }) {
  return (
    <div className={styles.extreme}>
      <dt>{label}</dt>
      <dd>
        {item ? (
          <>
            <Link href={`/stock/${item.symbol}`} className={styles.extremeSymbol}>
              {item.symbol}
            </Link>
            <span className={`${styles.extremePct} ${tone}`}>{signedPct(item.pct)}</span>
          </>
        ) : (
          <span className={styles.none}>—</span>
        )}
      </dd>
    </div>
  )
}
