import { Suspense } from 'react'
import { WatchlistSkeleton } from './WatchlistSkeleton'
import { connection } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { currentUserId, flatten } from '@/lib/watchlist'
import { QuickAdd } from '@/components/QuickAdd'
import { AddStockForm } from '@/components/AddStockForm'
import { RemoveStockButton } from '@/components/RemoveStockButton'
import { PriceChart } from '@/components/PriceChart'
import { AlertTargets } from '@/components/AlertTargets'
import { CompareSelectionProvider, CompareCheckbox, CompareBar } from '@/components/CompareSelection'
import { LiveChange, LivePrice, LiveSince } from '@/components/live-quotes'
import { WatchlistSummary } from '@/components/WatchlistSummary'
import { getIntradayHistory } from '@/lib/history'
import { getSector, sectorHue } from '@/lib/sector'
import styles from './page.module.css'
import { AuthGate } from '@/components/AuthGate'

type SortKey = 'sym' | 'settore' | 'prezzo' | 'oggi' | 'da'
type Search = { ordina?: string; dir?: string }

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'sym', label: 'Titolo' },
  { key: 'settore', label: 'Settore' },
  { key: 'prezzo', label: 'Prezzo' },
  { key: 'oggi', label: 'Oggi' },
  { key: 'da', label: 'Da quando lo segui' },
]

async function WatchlistTable({ searchParams }: { searchParams: Promise<Search> }) {
  await connection()
  const { ordina, dir } = await searchParams
  const sortKey = COLUMNS.find((c) => c.key === ordina)?.key ?? null
  const sortDir: 'asc' | 'desc' = dir === 'asc' ? 'asc' : 'desc'
  const entries = await prisma.watchlistEntry.findMany({
    where: { userId: await currentUserId() },
    orderBy: { addedAt: 'asc' },
    include: { stock: { include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 20 } } } },
  })
  const stocks = entries.map(flatten)

  if (stocks.length === 0) {
    return (
      <section className={styles.empty}>
        <h2 className={styles.emptyTitle}>La watchlist è vuota</h2>
        <p className={styles.emptyText}>Cerca un titolo qui sopra, oppure parti da uno di questi.</p>
        <QuickAdd symbols={['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA']} />
      </section>
    )
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
      <WatchlistSummary
        items={rows.map((r) => ({ symbol: r.stock.symbol, entryPrice: r.entryPrice, price: r.latest?.price ?? null }))}
      />
      <section className={styles.board}>
      <nav className={styles.sortBar} aria-label="Ordina la watchlist">
        <span className={styles.sortLabel}>Ordina per</span>
        {COLUMNS.map((c) => {
          const active = c.key === sortKey
          const nextDir = active && sortDir === 'desc' ? 'asc' : 'desc'
          const href = `/?${new URLSearchParams({ ordina: c.key, dir: c.key === 'sym' || c.key === 'settore' ? (active && sortDir === 'asc' ? 'desc' : 'asc') : nextDir })}`
          return (
            <Link key={c.key} href={href} className={styles.sort} data-active={active || undefined} aria-current={active ? 'true' : undefined}>
              {c.label}
              {active && <span className={styles.arrow} aria-label={sortDir === 'asc' ? 'crescente' : 'decrescente'}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
            </Link>
          )
        })}
      </nav>
      <CompareSelectionProvider>
      <ul className={styles.list}>
        {rows.map(({ stock, latest, ext, extPct, entryPrice, sector }) => {
          const changeTone = latest ? tone(latest.changePct) : styles.dash
          return (
            <li key={stock.id} className={styles.row}>
              <div className={styles.id}>
                <CompareCheckbox symbol={stock.symbol} />
                <Link href={`/stock/${stock.symbol}`} className={styles.symbol}>
                  {stock.symbol}
                </Link>
                <span className={styles.name}>{stock.name}</span>
              </div>
              <div className={styles.meta}>
                {sector && <span className={styles.sectorTag} style={{ '--hue': sectorHue(sector) } as React.CSSProperties}>{sector}</span>}
                {ext && extPct !== null && (
                  <span className={styles.extCell}>
                    {ext.session === 'pre' ? 'Pre-market' : 'After-hours'} ${ext.close.toFixed(2)}{' '}
                    <span className={tone(extPct)}>{signed(extPct)}</span>
                  </span>
                )}
                <AlertTargets
                  symbol={stock.symbol}
                  entryPrice={stock.entryPrice}
                  sellPrice={stock.sellPrice}
                  entryTriggered={stock.entryTriggeredAt !== null}
                  sellTriggered={stock.sellTriggeredAt !== null}
                />
              </div>
              <div className={styles.trend}>
                <PriceChart snapshots={stock.snapshots} width={132} height={40} strokeWidth={1.5} compact />
              </div>
              <div className={styles.priceCell}>
                {latest ? <LivePrice symbol={stock.symbol} initial={latest.price} /> : <span className={styles.dash}>—</span>}
              </div>
              <div className={styles.figures}>
                <span className={styles.figure} title={`dal ${stock.addedAt.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`}>
                  <span className={styles.figureLabel}>da quando lo segui</span>
                  <LiveSince symbol={stock.symbol} entryPrice={entryPrice} initialPrice={latest?.price ?? null} tones={tones} />
                </span>
                <span className={styles.figure}>
                  {latest ? <LiveChange symbol={stock.symbol} initial={latest.changePct} tones={tones} /> : <span className={changeTone}>—</span>}
                  <span className={styles.figureLabel}>oggi</span>
                </span>
              </div>
              <div className={styles.actions}>
                <RemoveStockButton symbol={stock.symbol} />
              </div>
            </li>
          )
        })}
      </ul>
      <CompareBar maxCount={4} />
      </CompareSelectionProvider>
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
      <Suspense fallback={<WatchlistSkeleton />}>
        <AuthGate path="/">
          <WatchlistTable searchParams={searchParams} />
        </AuthGate>
      </Suspense>
    </main>
  )
}
