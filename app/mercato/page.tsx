import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { getIpoCalendar, type IpoEvent } from '@/lib/finnhub'
import { bigMovers, BIG_MOVE_THRESHOLD_PCT } from '@/lib/market'
import { InfoTip } from '@/components/InfoTip'
import styles from './page.module.css'

const dayFormat: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }

function formatDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(`${d}T00:00:00Z`) : d
  return date.toLocaleDateString('it-IT', dayFormat)
}

function formatMoney(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} mld $`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} mln $`
  return `${n.toFixed(0)} $`
}

async function BigMovers() {
  await connection()
  const stocks = await prisma.stock.findMany({
    include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 1 } },
  })
  const movers = bigMovers(
    stocks.filter((s) => s.snapshots[0]).map((s) => ({ symbol: s.symbol, name: s.name, changePct: s.snapshots[0].changePct, price: s.snapshots[0].price }))
  )
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        Movimenti forti
        <InfoTip
          label="Cos’è questa sezione"
          source="Ultima rilevazione di prezzo salvata per ogni titolo della watchlist (Finnhub, /quote)"
          formula={`Compare un titolo se la variazione giornaliera è almeno ±${BIG_MOVE_THRESHOLD_PCT}%`}
        >
          <strong>Movimenti forti</strong>
          <span>I titoli della tua watchlist che nell’ultima rilevazione hanno guadagnato o perso almeno il {BIG_MOVE_THRESHOLD_PCT}% in una giornata.</span>
          <span>Finnhub gratuito non offre una classifica dell’intero mercato, quindi il controllo vale solo per i titoli che segui.</span>
        </InfoTip>
      </h2>
      <p className={styles.lead}>Titoli che si sono mossi di almeno il {BIG_MOVE_THRESHOLD_PCT}% in un giorno. Più piccoli di così non vengono segnalati.</p>
      {movers.length === 0 ? (
        <p className={styles.empty}>Nessun titolo della watchlist ha superato ±{BIG_MOVE_THRESHOLD_PCT}% nell’ultima rilevazione.</p>
      ) : (
        <ul className={styles.list}>
          {movers.map((m) => (
            <li key={m.symbol} className={styles.item}>
              <span className={m.changePct >= 0 ? styles.gain : styles.loss}>
                {m.changePct >= 0 ? '+' : '−'}
                {Math.abs(m.changePct).toFixed(2)}%
              </span>
              <span className={styles.main}>
                <Link href={`/stock/${m.symbol}`}>{m.symbol}</Link>
                <span className={styles.sub}>{m.name}</span>
              </span>
              <span className={styles.side}>${m.price.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

async function EarningsCalendar() {
  await connection()
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const stocks = await prisma.stock.findMany({
    where: { nextEarningsDate: { gte: start } },
    orderBy: { nextEarningsDate: 'asc' },
  })
  const hourLabel: Record<string, string> = { bmo: 'prima dell’apertura', amc: 'dopo la chiusura', dmh: 'durante la seduta' }
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Calendario trimestrali</h2>
      <p className={styles.lead}>Le prossime trimestrali dei titoli che segui, dalla più vicina. Le date si aggiornano a ogni refresh.</p>
      {stocks.length === 0 ? (
        <p className={styles.empty}>Nessuna trimestrale in programma: premi Refresh sui titoli per scaricare le date.</p>
      ) : (
        <ul className={styles.list}>
          {stocks.map((s) => (
            <li key={s.id} className={styles.item}>
              <span className={styles.date}>{formatDay(s.nextEarningsDate!)}</span>
              <span className={styles.main}>
                <Link href={`/stock/${s.symbol}`}>{s.symbol}</Link>
                <span className={styles.sub}>{s.name}</span>
              </span>
              <span className={styles.side}>
                {s.nextEarningsHour && hourLabel[s.nextEarningsHour] ? `${hourLabel[s.nextEarningsHour]}` : ''}
                {s.nextEarningsEpsEstimate !== null ? `${s.nextEarningsHour ? ' · ' : ''}EPS atteso ${s.nextEarningsEpsEstimate.toFixed(2)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

async function IpoList() {
  await connection()
  const now = new Date()
  const from = now.toISOString().slice(0, 10)
  const to = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  let ipos: IpoEvent[] | null = null
  try {
    ipos = await getIpoCalendar(from, to)
  } catch (err) {
    console.error('IPO calendar failed:', err instanceof Error ? err.message : err)
    ipos = null
  }
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Nuove quotazioni (IPO)</h2>
      <p className={styles.lead}>Società che debuttano in Borsa nei prossimi 45 giorni, in ordine di data.</p>
      {ipos === null ? (
        <p className={styles.empty}>Non riesco a scaricare il calendario IPO in questo momento. Riprova tra qualche minuto.</p>
      ) : ipos.length === 0 ? (
        <p className={styles.empty}>Nessuna IPO in calendario nei prossimi 45 giorni.</p>
      ) : (
        <ul className={styles.list}>
          {ipos.map((i, idx) => (
            <li key={`${i.date}-${i.name}-${idx}`} className={styles.item}>
              <span className={styles.date}>{formatDay(i.date)}</span>
              <span className={styles.main}>
                {i.name}
                <span className={styles.sub}>{[i.symbol, i.exchange].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={styles.side}>
                {i.price ? `${i.price} $` : ''}
                {i.totalValue ? `${i.price ? ' · ' : ''}${formatMoney(i.totalValue)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function MarketPage() {
  return (
    <main className={styles.shell}>
      <Link href="/" className={styles.back}>
        ← Watchlist
      </Link>
      <h1 className={styles.title}>Mercato</h1>
      <Suspense fallback={<p className={styles.empty}>Carico i movimenti…</p>}>
        <BigMovers />
      </Suspense>
      <Suspense fallback={<p className={styles.empty}>Carico le trimestrali…</p>}>
        <EarningsCalendar />
      </Suspense>
      <Suspense fallback={<p className={styles.empty}>Carico le IPO…</p>}>
        <IpoList />
      </Suspense>
    </main>
  )
}
