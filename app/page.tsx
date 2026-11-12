import { Suspense } from 'react'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { AddStockForm } from '@/components/AddStockForm'
import { RemoveStockButton } from '@/components/RemoveStockButton'
import { PriceChart } from '@/components/PriceChart'

async function WatchlistTable() {
  const stocks = await prisma.stock.findMany({
    orderBy: { addedAt: 'asc' },
    include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 20 } },
  })

  if (stocks.length === 0) {
    return <p>No stocks yet. Add a symbol above to get started.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Name</th>
          <th>Price</th>
          <th>Change %</th>
          <th>Trend</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {stocks.map((stock) => {
          const latest = stock.snapshots[0]
          return (
            <tr key={stock.id}>
              <td>
                <Link href={`/stock/${stock.symbol}`}>{stock.symbol}</Link>
              </td>
              <td>{stock.name}</td>
              <td>{latest ? `$${latest.price.toFixed(2)}` : '—'}</td>
              <td>{latest ? `${latest.changePct.toFixed(2)}%` : '—'}</td>
              <td>
                <PriceChart snapshots={stock.snapshots} width={80} height={24} />
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
    <main>
      <h1>Watchlist</h1>
      <AddStockForm />
      <Suspense fallback={<p>Loading watchlist...</p>}>
        <WatchlistTable />
      </Suspense>
    </main>
  )
}
