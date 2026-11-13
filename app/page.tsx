import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { AddStockForm } from '@/components/AddStockForm'
import { RemoveStockButton } from '@/components/RemoveStockButton'
import { PriceChart } from '@/components/PriceChart'
import { AlertTargets } from '@/components/AlertTargets'
import { LiveChange, LiveCounts, LivePrice, LiveSince } from '@/components/live-quotes'
import { getIntradayHistory } from '@/lib/history'
import { getSector, sectorHue } from '@/lib/sector'
import styles from './page.module.css'

type SortKey = 'sym' | 'settore' | 'prezzo' | 'ext' | 'oggi' | 'da'
type Search = { ordina?: string; dir?: string }

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'sym', label: 'Titolo', numeric: false },
  { key: 'settore', label: 'Settore', numeric: false },
  { key: 'prezzo', label: 'Prezzo', numeric: true },
  { key: 'ext', label: 'Pre/Post-market', numeric: true },
  { key: 'oggi', label: 'Ultima chiusura', numeric: true },
  { key: 'da', label: 'Da quando lo segui', numeric: true },
]

async function WatchlistTable({ searchParams }: { searchParams: Promise<Search> }) {
  await connection()
  const { ordina, dir } = await searchParams
  const sortKey = COLUMNS.find((c) => c.key === ordina)?.key ?? null
  const sortDir: 'asc' | 'desc' = dir === 'asc' ? 'asc' : 'desc'
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

  const sectors = await Promise.all(stocks.map((stock) => getSector(stock.symbol)))

  const unsorted = stocks.map((stock, idx) => {
    const latest = stock.snapshots[0]
    const ext = extended[idx]
    const entry = firstSnapshots[idx]
    const extPct = ext && latest ? ((ext.close - latest.price) / latest.price) * 100 : null
    const sincePct = latest && entry && entry.price > 0 ? ((latest.price - entry.price) / entry.price) * 100 : null
    return { stock, latest, ext, extPct, sincePct, entryPrice: entry?.price ?? null, sector: sectors[idx] }
  })
  const sortValue = (r: (typeof unsorted)[number]): number | string | null => {
    switch (sortKey) {
      case 'sym': return r.stock.symbol
      case 'settore': return r.sector
      case 'prezzo': return r.latest?.price ?? null
      case 'ext': return r.extPct
      case 'oggi': return r.latest?.changePct ?? null
      case 'da': return r.sincePct
      default: return null
    }
  }
  const rows = sortKey
    ? [...unsorted].sort((a, b) => {
        const x = sortValue(a)
        const y = sortValue(b)
        if (x === null && y === null) return 0
        if (x === null) return 1
        if (y === null) return -1
        const cmp = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)
        return sortDir === 'asc' ? cmp : -cmp
      })
    : unsorted
  const tone = (n: number | null) => (n === null || n === 0 ? styles.dash : n > 0 ? styles.gain : styles.loss)
  const tones = { gain: styles.gain, loss: styles.loss, flat: styles.dash }
  const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`

  return (
    <>
      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>{stocks.length === 1 ? 'Titolo' : 'Titoli'} seguiti</span>
          <span className={styles.kpiValue}>{stocks.length}</span>
        </div>
        <LiveCounts
          items={rows.map((r) => ({ symbol: r.stock.symbol, entryPrice: r.entryPrice, price: r.latest?.price ?? null }))}
          labels={{ gainClass: styles.gain, lossClass: styles.loss, kpi: styles.kpi, kpiLabel: styles.kpiLabel, kpiValue: styles.kpiValue, kpiNote: styles.kpiNote }}
        />
      </div>
      <section className={styles.board}>
      <div className={styles.listHead}>
        {COLUMNS.map((c) => {
          const active = c.key === sortKey
          const nextDir = active && sortDir === 'desc' ? 'asc' : 'desc'
          const href = `/?${new URLSearchParams({ ordina: c.key, dir: c.key === 'sym' || c.key === 'settore' ? (active && sortDir === 'asc' ? 'desc' : 'asc') : nextDir })}`
          return (
            <Link key={c.key} href={href} className={`${styles.sort} ${c.numeric ? styles.num : ''}`} data-active={active || undefined} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
              {c.label}
              <span className={styles.arrow} aria-hidden="true">{active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
            </Link>
          )
        })}
        <span />
        <span />
      </div>
      <ul className={styles.list}>
        {rows.map(({ stock, latest, ext, extPct, entryPrice, sector }) => {
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
              <div className={styles.sectorCell}>{sector ? <span className={styles.sectorTag} style={{ '--hue': sectorHue(sector) } as React.CSSProperties}>{sector}</span> : <span className={styles.dash}>—</span>}</div>
              <div className={`${styles.num} ${styles.priceCell}`} data-label="Prezzo">
                <span className={styles.price}>{latest ? <LivePrice symbol={stock.symbol} initial={latest.price} /> : <span className={styles.dash}>—</span>}</span>
              </div>
              <div className={`${styles.num} ${styles.extCell} ${ext && extPct !== null ? '' : styles.extEmpty}`} data-label="Pre/Post-market">
                {ext && extPct !== null ? (
                  <>
                    <span className={styles.extKind}>{ext.session === 'pre' ? 'Pre-market' : 'After-hours'}</span>
                    <span className={styles.extPrice}>${ext.close.toFixed(2)}</span>
                    <span className={`${styles.ext} ${tone(extPct)}`}>{signed(extPct)}</span>
                  </>
                ) : (
                  <span className={styles.dash}>—</span>
                )}
              </div>
              <div className={`${styles.num} ${styles.change} ${changeTone}`} data-label="Ultima chiusura">
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
                <PriceChart snapshots={stock.snapshots} width={88} height={22} strokeWidth={1.5} compact />
              </div>
              <div className={styles.actions}>
                <RemoveStockButton symbol={stock.symbol} />
              </div>
            </li>
          )
        })}
      </ul>
      </section>
    </>
  )
}

export default function WatchlistPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className={styles.shell}>
      <header className={styles.masthead}>
        <div>
          <h1 className={styles.title}>La tua watchlist</h1>
        </div>
        <AddStockForm />
      </header>
      <Suspense fallback={<p className={styles.empty}>Carico la watchlist…</p>}>
        <WatchlistTable searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
