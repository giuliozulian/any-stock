import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { AddStockForm } from '@/components/AddStockForm'
import { RemoveStockButton } from '@/components/RemoveStockButton'
import { PriceChart } from '@/components/PriceChart'
import { getIntradayHistory } from '@/lib/history'
import styles from './page.module.css'

async function WatchlistTable() {
  await connection()
  const stocks = await prisma.stock.findMany({
    orderBy: { addedAt: 'asc' },
    include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 20 } },
  })

  if (stocks.length === 0) {
    return <p className={styles.empty}>No stocks yet. Add a symbol above to get started.</p>
  }

  const firstSnapshots = await Promise.all(
    stocks.map((stock) => prisma.priceSnapshot.findFirst({ where: { stockId: stock.id }, orderBy: { timestamp: 'asc' }, select: { price: true } }))
  )

  const extended = await Promise.all(
    stocks.map(async (stock) => {
      const last = (await getIntradayHistory(stock.symbol)).points.at(-1)
      return last && last.session !== 'regular' ? last : null
    })
  )

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Company</th>
          <th className={styles.num}>Price</th>
          <th className={styles.num}>Change</th>
          <th className={styles.num}>Pre/Post</th>
          <th className={styles.num}>Trend</th>
          <th className={styles.num}>Lo segui dal</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {stocks.map((stock, idx) => {
          const latest = stock.snapshots[0]
          const ext = extended[idx]
          const extPct = ext && stock.snapshots[0] ? ((ext.close - stock.snapshots[0].price) / stock.snapshots[0].price) * 100 : null
          const entry = firstSnapshots[idx]
          const sincePct = latest && entry && entry.price > 0 ? ((latest.price - entry.price) / entry.price) * 100 : null
          const sinceClass = sincePct === null || sincePct === 0 ? styles.dash : sincePct > 0 ? styles.gain : styles.loss
          const changeClass = !latest ? styles.dash : latest.changePct >= 0 ? styles.gain : styles.loss
          return (
            <tr key={stock.id}>
              <td>
                <Link href={`/stock/${stock.symbol}`} className={styles.symbol}>
                  {stock.symbol}
                </Link>
              </td>
              <td className={styles.name}>{stock.name}</td>
              <td className={`${styles.num} ${styles.price}`}>
                {latest ? `$${latest.price.toFixed(2)}` : <span className={styles.dash}>—</span>}
              </td>
              <td className={`${styles.num} ${styles.change} ${changeClass}`}>
                {latest ? `${latest.changePct >= 0 ? '+' : ''}${latest.changePct.toFixed(2)}%` : '—'}
              </td>
              <td className={`${styles.num} ${extPct === null ? styles.dash : extPct >= 0 ? styles.gain : styles.loss}`}>
                {ext && extPct !== null ? (
                  <>
                    ${ext.close.toFixed(2)} ({extPct >= 0 ? '+' : ''}
                    {extPct.toFixed(2)}%) <small>{ext.session === 'pre' ? 'pre' : 'post'}</small>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td className={`${styles.num} ${changeClass}`}>
                <PriceChart snapshots={stock.snapshots} width={72} height={22} strokeWidth={1.5} compact />
              </td>
              <td className={styles.num}>
                <time dateTime={stock.addedAt.toISOString()}>{stock.addedAt.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}</time>
                <span className={`${styles.sinceDelta} ${sinceClass}`}>{sincePct === null ? '—' : `${sincePct >= 0 ? '+' : '−'}${Math.abs(sincePct).toFixed(1)}%`}</span>
              </td>
              <td>
                <RemoveStockButton symbol={stock.symbol} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function WatchlistPage() {
  return (
    <main className={styles.shell}>
      <div className={styles.masthead}>
        <span className={styles.wordmark}>Any Stock</span>
        <AddStockForm />
      </div>
      <Suspense fallback={<p className={styles.empty}>Loading watchlist…</p>}>
        <WatchlistTable />
      </Suspense>
    </main>
  )
}
