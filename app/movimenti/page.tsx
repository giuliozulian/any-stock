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


const THRESHOLDS = [5, 10, BIG_MOVE_THRESHOLD_PCT]

async function BigMovers({ searchParams }: { searchParams: Promise<{ soglia?: string }> }) {
  await connection()
  const { soglia } = await searchParams
  const parsed = Number(soglia)
  const threshold = THRESHOLDS.includes(parsed) ? parsed : BIG_MOVE_THRESHOLD_PCT
  const [watched, marketResult] = await Promise.all([
    prisma.stock.findMany({ select: { symbol: true } }),
    getMarketBigMovers(threshold).then(
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
          formula={`Compare un titolo se la variazione giornaliera è almeno ±${threshold}% e il prezzo è almeno 1 $`}
        >
          <strong>Movimenti forti</strong>
          <span>Tutti i titoli USA che oggi hanno guadagnato o perso almeno il {threshold}%, non solo quelli che segui.</span>
          <span>Ho escluso i titoli sotto 1 $ perché sono quasi sempre rumore. Yahoo pubblica solo le sue classifiche dei titoli che salgono e scendono di più, quindi nei giorni tranquilli i risultati sono pochi.</span>
        </InfoTip>
      </h2>
      <p className={styles.lead}>Titoli di tutto il mercato USA che oggi si sono mossi di almeno il {threshold}%. Quelli in watchlist sono segnati.</p>
      <p className={styles.lead}>
        Soglia:{' '}
        {THRESHOLDS.map((t) => (
          <Link key={t} href={`/movimenti?soglia=${t}`} aria-current={t === threshold ? 'page' : undefined} style={{ marginRight: 12, fontWeight: t === threshold ? 700 : 400 }}>
            ±{t}%
          </Link>
        ))}
      </p>
      {failed ? (
        <p className={styles.empty}>Non riesco a scaricare le classifiche del mercato in questo momento. Riprova tra qualche minuto.</p>
      ) : movers.length === 0 ? (
        <p className={styles.empty}>Oggi nessun titolo ha superato ±{threshold}%. Prova una soglia più bassa.</p>
      ) : (
        <ul className={styles.list}>
          {movers.map((m) => (
            <li key={m.symbol} className={styles.item}>
              <span className={m.changePct >= 0 ? styles.gain : styles.loss}>
                {m.changePct >= 0 ? '+' : '−'}
                {Math.abs(m.changePct).toFixed(2)}%
              </span>
              <span className={styles.main}>
                <Link href={`/stock/${encodeURIComponent(m.symbol)}`}>{m.symbol}</Link>
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

export default function MoversPage({ searchParams }: { searchParams: Promise<{ soglia?: string }> }) {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Movimenti forti</h1>
      <Suspense fallback={<p className={styles.empty}>Carico i movimenti…</p>}>
        <BigMovers searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
