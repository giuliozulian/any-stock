import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { getMarketBigMovers, BIG_MOVE_THRESHOLD_PCT, type MarketMover } from '@/lib/market'
import { InfoTip } from '@/components/InfoTip'
import styles from '../section.module.css'

function formatMoney(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} mld $`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} mln $`
  return `${n.toFixed(0)} $`
}


async function BigMovers() {
  await connection()
  const [watched, marketResult] = await Promise.all([
    prisma.stock.findMany({ select: { symbol: true } }),
    getMarketBigMovers().then(
      (movers) => ({ movers, failed: false }),
      (err) => {
        console.error('Market movers failed:', err instanceof Error ? err.message : err)
        return { movers: [] as MarketMover[], failed: true }
      }
    ),
  ])
  const watchedSymbols = new Set(watched.map((s) => s.symbol))
  const { movers, failed } = marketResult
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        Movimenti forti
        <InfoTip
          label="Cos’è questa sezione"
          source="Yahoo Finance, classifiche pubbliche dei titoli USA che salgono e scendono di più oggi"
          formula={`Compare un titolo se la variazione giornaliera è almeno ±${BIG_MOVE_THRESHOLD_PCT}% e il prezzo è almeno 1 $`}
        >
          <strong>Movimenti forti</strong>
          <span>Tutti i titoli USA che oggi hanno guadagnato o perso almeno il {BIG_MOVE_THRESHOLD_PCT}%, non solo quelli che segui.</span>
          <span>Ho escluso i titoli sotto 1 $ perché sono quasi sempre rumore. Le classifiche mostrano i primi 100 per direzione.</span>
        </InfoTip>
      </h2>
      <p className={styles.lead}>Titoli di tutto il mercato USA che oggi si sono mossi di almeno il {BIG_MOVE_THRESHOLD_PCT}%. Quelli in watchlist sono segnati.</p>
      {failed ? (
        <p className={styles.empty}>Non riesco a scaricare le classifiche del mercato in questo momento. Riprova tra qualche minuto.</p>
      ) : movers.length === 0 ? (
        <p className={styles.empty}>Oggi nessun titolo ha superato ±{BIG_MOVE_THRESHOLD_PCT}%.</p>
      ) : (
        <ul className={styles.list}>
          {movers.map((m) => (
            <li key={m.symbol} className={styles.item}>
              <span className={m.changePct >= 0 ? styles.gain : styles.loss}>
                {m.changePct >= 0 ? '+' : '−'}
                {Math.abs(m.changePct).toFixed(2)}%
              </span>
              <span className={styles.main}>
                {watchedSymbols.has(m.symbol) ? <Link href={`/stock/${m.symbol}`}>{m.symbol}</Link> : m.symbol}
                <span className={styles.sub}>
                  {m.name}
                  {watchedSymbols.has(m.symbol) ? ' · in watchlist' : ''}
                </span>
              </span>
              <span className={styles.side}>
                ${m.price.toFixed(2)}
                {m.marketCap ? ` · cap ${formatMoney(m.marketCap)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function MoversPage() {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Movimenti forti</h1>
      <Suspense fallback={<p className={styles.empty}>Carico i movimenti…</p>}>
        <BigMovers />
      </Suspense>
    </main>
  )
}
