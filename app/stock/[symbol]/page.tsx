import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { PriceChart } from '@/components/PriceChart'
import { NewsList } from '@/components/NewsList'
import { RefreshButton } from '@/components/RefreshButton'

async function StockDetail({ paramsPromise }: { paramsPromise: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await paramsPromise
  const symbol = rawSymbol.toUpperCase()

  const stock = await prisma.stock.findUnique({
    where: { symbol },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 100 },
      news: { orderBy: { publishedAt: 'desc' }, take: 20 },
    },
  })

  if (!stock) {
    notFound()
  }

  const latest = stock.snapshots[0]

  return (
    <>
      <h1>
        {stock.symbol} — {stock.name}
      </h1>
      <RefreshButton symbol={stock.symbol} />
      {latest ? (
        <section>
          <p>
            Price: ${latest.price.toFixed(2)} ({latest.changePct.toFixed(2)}%)
          </p>
          <p>P/E: {latest.peRatio ?? '—'}</p>
          <p>Market cap: {latest.marketCap ?? '—'}</p>
          <p>
            52w range: {latest.week52Low ?? '—'} – {latest.week52High ?? '—'}
          </p>
          <p>Updated at {latest.timestamp.toLocaleString()}</p>
        </section>
      ) : (
        <p>No data yet. Refresh to fetch the latest snapshot.</p>
      )}
      <PriceChart snapshots={stock.snapshots} />
      <section>
        <h2>Considerations</h2>
        <p>Valuation and buy/sell signals are not implemented yet.</p>
      </section>
      <NewsList news={stock.news} />
    </>
  )
}

export default function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  return (
    <main>
      <Suspense fallback={<p>Loading stock...</p>}>
        <StockDetail paramsPromise={params} />
      </Suspense>
    </main>
  )
}
