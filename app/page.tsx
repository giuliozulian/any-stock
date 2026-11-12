import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { AddStockForm } from '@/components/AddStockForm'
import { RemoveStockButton } from '@/components/RemoveStockButton'
import { PriceChart } from '@/components/PriceChart'
import { AlertTargets } from '@/components/AlertTargets'
import { LiveChange, LivePrice, LiveSince } from '@/components/live-quotes'
import { getIntradayHistory } from '@/lib/history'
import styles from './page.module.css'

async function WatchlistTable() {
  await connection()
  const stocks = await prisma.stock.findMany({
    orderBy: { addedAt: 'asc' },
    include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 20 } },
  })

  if (stocks.length === 0) {
    return <p className={styles.empty}>Nessun titolo in watchlist. Scrivi un simbolo (per esempio AAPL) in alto a destra e premi Add.</p>
  }

  const firstRows = await prisma.priceSnapshot.findMany({
    where: { stockId: { in: stocks.map((s) => s.id) } },
    orderBy: { timestamp: 'asc' },
    distinct: ['stockId'],
    select: { stockId: true, price: true },
  })
  const firstByStock = new Map(firstRows.map((r) => [r.stockId, r]))
  const firstSnapshots = stocks.map((stock) => firstByStock.get(stock.id) ?? null)

  const extended = await Promise.all(
    stocks.map(async (stock) => {
      const last = (await getIntradayHistory(stock.symbol)).points.at(-1)
      return last && last.session !== 'regular' ? last : null
    })
  )

  const rows = stocks.map((stock, idx) => {
    const latest = stock.snapshots[0]
    const ext = extended[idx]
    const entry = firstSnapshots[idx]
    const extPct = ext && latest ? ((ext.close - latest.price) / latest.price) * 100 : null
    const sincePct = latest && entry && entry.price > 0 ? ((latest.price - entry.price) / entry.price) * 100 : null
    return { stock, latest, ext, extPct, sincePct, entryPrice: entry?.price ?? null }
  })
  const gaining = rows.filter((r) => r.sincePct !== null && r.sincePct > 0).length
  const losing = rows.filter((r) => r.sincePct !== null && r.sincePct < 0).length
  const tone = (n: number | null) => (n === null || n === 0 ? styles.dash : n > 0 ? styles.gain : styles.loss)
  const tones = { gain: styles.gain, loss: styles.loss, flat: styles.dash }
  const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`

  return (
    <>
      <p className={styles.summary}>
        {stocks.length} {stocks.length === 1 ? 'titolo' : 'titoli'} · <span className={styles.gain}>{gaining} in guadagno</span> · <span className={styles.loss}>{losing} in perdita</span> da quando li segui
      </p>
      <div className={styles.listHead} aria-hidden="true">
        <span>Titolo</span>
        <span className={styles.num}>Prezzo</span>
        <span className={styles.num}>Oggi</span>
        <span className={styles.num}>Da quando lo segui</span>
        <span className={styles.num}>Trend</span>
        <span />
      </div>
      <ul className={styles.list}>
        {rows.map(({ stock, latest, ext, extPct, entryPrice }) => {
          const changeTone = latest ? tone(latest.changePct) : styles.dash
          return (
            <li key={stock.id} className={styles.row}>
              <div className={styles.titleCell}>
                <Link href={`/stock/${stock.symbol}`} className={styles.symbol}>
                  {stock.symbol}
                </Link>
                <span className={styles.name}>{stock.name}</span>
                <AlertTargets
                  symbol={stock.symbol}
                  entryPrice={stock.entryPrice}
                  sellPrice={stock.sellPrice}
                  entryTriggered={stock.entryTriggeredAt !== null}
                  sellTriggered={stock.sellTriggeredAt !== null}
                />
              </div>
              <div className={`${styles.num} ${styles.priceCell}`} data-label="Prezzo">
                <span className={styles.price}>{latest ? <LivePrice symbol={stock.symbol} initial={latest.price} /> : <span className={styles.dash}>—</span>}</span>
                {ext && extPct !== null && (
                  <span className={`${styles.ext} ${tone(extPct)}`}>
                    {ext.session === 'pre' ? 'Pre-market' : 'After-hours'} ${ext.close.toFixed(2)} ({signed(extPct)})
                  </span>
                )}
              </div>
              <div className={`${styles.num} ${styles.change} ${changeTone}`} data-label="Oggi">
                {latest ? <LiveChange symbol={stock.symbol} initial={latest.changePct} tones={tones} /> : '—'}
              </div>
              <div className={`${styles.num} ${styles.sinceCell}`} data-label="Da quando lo segui">
                <span className={styles.sincePct}>
                  <LiveSince symbol={stock.symbol} entryPrice={entryPrice} initialPrice={latest?.price ?? null} tones={tones} />
                </span>
                <time className={styles.sinceDate} dateTime={stock.addedAt.toISOString()}>
                  dal {stock.addedAt.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
                </time>
              </div>
              <div className={`${styles.num} ${styles.trend} ${changeTone}`}>
                <PriceChart snapshots={stock.snapshots} width={88} height={28} strokeWidth={1.5} compact />
              </div>
              <div className={styles.actions}>
                <RemoveStockButton symbol={stock.symbol} />
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export default function WatchlistPage() {
  return (
    <main className={styles.shell}>
      <header className={styles.masthead}>
        <div>
          <p className={styles.wordmark}>Any Stock</p>
          <h1 className={styles.title}>La tua watchlist</h1>
          <Link href="/mercato" className={styles.name}>
            Mercato: movimenti forti, trimestrali e IPO
          </Link>
        </div>
        <AddStockForm />
      </header>
      <Suspense fallback={<p className={styles.empty}>Carico la watchlist…</p>}>
        <WatchlistTable />
      </Suspense>
    </main>
  )
}
