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
import { DropdownMenu } from '@/components/DropdownMenu'
import { applyView, isFiltered, nextSortDir, parseView, viewHref, SORT_OPTIONS, TREND_OPTIONS, type ViewParams } from '@/lib/watchlist-view'
import styles from './page.module.css'
import { AuthGate } from '@/components/AuthGate'

type Search = ViewParams

// What each sort puts first, said in the menu so a choice needs no guessing.
function sortHint(key: string): string {
  switch (key) {
    case 'sym':
    case 'settore':
      return 'A-Z'
    case 'agg':
      return 'più recenti'
    default:
      return 'più alto'
  }
}

async function WatchlistTable({ searchParams }: { searchParams: Promise<Search> }) {
  await connection()
  const params = await searchParams
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

  // Snapshots are shared by everyone who watches a stock: each baseline is the first one taken since this user added it.
  const firstRows = await prisma.priceSnapshot.findMany({
    where: { OR: stocks.map((s) => ({ stockId: s.id, timestamp: { gte: s.addedAt } })) },
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

  const all = stocks.map((stock, idx) => {
    const latest = stock.snapshots[0]
    const ext = extended[idx]
    const entry = firstSnapshots[idx]
    const extPct = ext && latest ? ((ext.close - latest.price) / latest.price) * 100 : null
    const sincePct = latest && entry && entry.price > 0 ? ((latest.price - entry.price) / entry.price) * 100 : null
    return { stock, latest, ext, extPct, sincePct, entryPrice: entry?.price ?? null, sector: sectors[idx] }
  })
  const sectorList = [...new Set(all.map((r) => r.sector).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b))
  const view = parseView(params, sectorList)
  const viewRows = all.map((r) => ({
    ...r,
    symbol: r.stock.symbol,
    name: r.stock.name,
    price: r.latest?.price ?? null,
    marketCap: r.latest?.marketCap ?? null,
    changePct: r.latest?.changePct ?? null,
    addedAt: r.stock.addedAt,
    hasAlert: r.stock.entryPrice !== null || r.stock.sellPrice !== null,
  }))
  const rows = applyView(viewRows, view)
  const activeFilters = Number(view.trend !== 'tutti') + Number(view.onlyAlerts) + Number(view.sector !== null)
  const tone = (n: number | null) => (n === null || n === 0 ? styles.dash : n > 0 ? styles.gain : styles.loss)
  const tones = { gain: styles.gain, loss: styles.loss, flat: styles.dash }
  const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`

  return (
    <>
      <WatchlistSummary
        items={all.map((r) => ({ symbol: r.stock.symbol, entryPrice: r.entryPrice, price: r.latest?.price ?? null }))}
      />
      <section className={styles.board}>
      <div className={styles.toolbar}>
        <form action="/" method="get" role="search" className={styles.search}>
          {view.sortKey && <input type="hidden" name="ordina" value={view.sortKey} />}
          {view.sortKey && <input type="hidden" name="dir" value={view.sortDir} />}
          {view.sector && <input type="hidden" name="settore" value={view.sector} />}
          {view.trend !== 'tutti' && <input type="hidden" name="andamento" value={view.trend} />}
          {view.onlyAlerts && <input type="hidden" name="avvisi" value="1" />}
          <input type="search" name="q" defaultValue={view.query} placeholder="Cerca simbolo o nome" aria-label="Cerca nella watchlist" maxLength={40} className={styles.searchInput} />
          <button type="submit" className={styles.searchButton} aria-label="Cerca">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </form>

        <DropdownMenu label="Filtri" count={activeFilters}>
          <section className={styles.menuSection}>
            <h3 className={styles.menuTitle}>Andamento</h3>
            <ul className={styles.menuList}>
              {TREND_OPTIONS.map((t) => (
                <li key={t.key}>
                  <Link href={viewHref(view, { andamento: t.key === 'tutti' ? '' : t.key })} className={styles.menuItem} aria-current={view.trend === t.key ? 'true' : undefined}>
                    {t.label}
                    {view.trend === t.key && <span className={styles.check} aria-hidden="true">✓</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section className={styles.menuSection}>
            <h3 className={styles.menuTitle}>Avvisi</h3>
            <ul className={styles.menuList}>
              <li>
                <Link href={viewHref(view, { avvisi: view.onlyAlerts ? '' : '1' })} className={styles.menuItem} aria-current={view.onlyAlerts ? 'true' : undefined}>
                  Solo titoli con un avviso di prezzo
                  {view.onlyAlerts && <span className={styles.check} aria-hidden="true">✓</span>}
                </Link>
              </li>
            </ul>
          </section>
          {sectorList.length > 1 && (
            <section className={styles.menuSection}>
              <h3 className={styles.menuTitle}>Settore</h3>
              <ul className={styles.menuList}>
                <li>
                  <Link href={viewHref(view, { settore: '' })} className={styles.menuItem} aria-current={view.sector === null ? 'true' : undefined}>
                    Tutti i settori
                    {view.sector === null && <span className={styles.check} aria-hidden="true">✓</span>}
                  </Link>
                </li>
                {sectorList.map((sector) => (
                  <li key={sector}>
                    <Link href={viewHref(view, { settore: sector })} className={styles.menuItem} aria-current={view.sector === sector ? 'true' : undefined}>
                      {sector}
                      {view.sector === sector && <span className={styles.check} aria-hidden="true">✓</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </DropdownMenu>

        <DropdownMenu label={view.sortKey ? `Ordina: ${SORT_OPTIONS.find((o) => o.key === view.sortKey)!.label} ${view.sortDir === 'asc' ? '↑' : '↓'}` : 'Ordina'} active={view.sortKey !== null}>
          <ul className={styles.menuList}>
            {SORT_OPTIONS.map((o) => {
              const active = o.key === view.sortKey
              return (
                <li key={o.key}>
                  <Link href={viewHref(view, { ordina: o.key, dir: nextSortDir(view, o.key) })} className={styles.menuItem} aria-current={active ? 'true' : undefined}>
                    {o.label}
                    {active ? <span className={styles.check}>{view.sortDir === 'asc' ? 'crescente ↑' : 'decrescente ↓'}</span> : <span className={styles.hintText}>{sortHint(o.key)}</span>}
                  </Link>
                </li>
              )
            })}
            {view.sortKey && (
              <li>
                <Link href={viewHref(view, { ordina: '', dir: '' })} className={styles.menuItem}>
                  Ordine in cui li hai aggiunti
                </Link>
              </li>
            )}
          </ul>
        </DropdownMenu>
      </div>

      {isFiltered(view) && (
        <div className={styles.chipsRow}>
          <ul className={styles.chips} aria-label="Filtri attivi">
            {view.query && (
              <li>
                <Link href={viewHref(view, { q: '' })} className={styles.chip} aria-label={`Togli la ricerca ${view.query}`}>
                  «{view.query}» <span aria-hidden="true">×</span>
                </Link>
              </li>
            )}
            {view.trend !== 'tutti' && (
              <li>
                <Link href={viewHref(view, { andamento: '' })} className={styles.chip} aria-label={`Togli il filtro ${TREND_OPTIONS.find((t) => t.key === view.trend)!.label}`}>
                  {TREND_OPTIONS.find((t) => t.key === view.trend)!.label} <span aria-hidden="true">×</span>
                </Link>
              </li>
            )}
            {view.onlyAlerts && (
              <li>
                <Link href={viewHref(view, { avvisi: '' })} className={styles.chip} aria-label="Togli il filtro Con avvisi">
                  Con avvisi <span aria-hidden="true">×</span>
                </Link>
              </li>
            )}
            {view.sector && (
              <li>
                <Link href={viewHref(view, { settore: '' })} className={styles.chip} aria-label={`Togli il filtro ${view.sector}`}>
                  {view.sector} <span aria-hidden="true">×</span>
                </Link>
              </li>
            )}
          </ul>
          <p className={styles.filterNote}>
            {rows.length} di {all.length} titoli
            {' · '}
            <Link href={viewHref({ ...view, sector: null, trend: 'tutti', onlyAlerts: false, query: '' })}>Azzera</Link>
          </p>
        </div>
      )}
      <CompareSelectionProvider>
      {rows.length === 0 && <p className={styles.emptyText}>Nessun titolo corrisponde ai filtri scelti.</p>}
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
                  price={latest?.price ?? null}
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
