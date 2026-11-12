import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { PriceChart } from '@/components/PriceChart'
import { NewsList } from '@/components/NewsList'
import { RefreshButton } from '@/components/RefreshButton'
import { EvaluationPanel } from '@/components/EvaluationPanel'
import { evaluateStock } from '@/lib/evaluate'
import styles from './page.module.css'

function formatExchange(exchange: string): string {
  if (exchange.includes('NASDAQ')) return 'NASDAQ'
  if (exchange.includes('NYSE')) return 'NYSE'
  return exchange.split(' - ')[0]
}

async function StockDetail({ paramsPromise }: { paramsPromise: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await paramsPromise
  const symbol = rawSymbol.toUpperCase()

  const stock = await prisma.stock.findUnique({
    where: { symbol },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 100 },
      news: { orderBy: { publishedAt: 'desc' }, take: 20 },
      recommendations: { orderBy: { period: 'desc' }, take: 2 },
    },
  })

  if (!stock) {
    notFound()
  }

  const latest = stock.snapshots[0]
  const changeClass = latest ? (latest.changePct >= 0 ? styles.gain : styles.loss) : ''

  const earliestSnapshot =
    stock.snapshots.length > 1
      ? await prisma.priceSnapshot.findFirst({
          where: { stockId: stock.id },
          orderBy: { timestamp: 'asc' },
        })
      : null

  const evaluation = latest
    ? evaluateStock({
        latestSnapshot: {
          price: latest.price,
          week52High: latest.week52High,
          week52Low: latest.week52Low,
          relativePerf13W: latest.relativePerf13W,
          pegRatio: latest.pegRatio,
          roe: latest.roe,
          debtToEquity: latest.debtToEquity,
          netMargin: latest.netMargin,
          dividendYield: latest.dividendYield,
          payoutRatio: latest.payoutRatio,
          epsTTM: latest.epsTTM,
          epsGrowth5Y: latest.epsGrowth5Y,
        },
        earliestSnapshot: earliestSnapshot ? { price: earliestSnapshot.price, timestamp: earliestSnapshot.timestamp } : null,
        recentRecommendations: stock.recommendations.map((r) => ({
          period: r.period,
          strongBuy: r.strongBuy,
          buy: r.buy,
          hold: r.hold,
          sell: r.sell,
          strongSell: r.strongSell,
        })),
      })
    : null

  return (
    <>
      <Link href="/" className={styles.back}>
        ← Watchlist
      </Link>

      <p className={styles.ticker}>
        {formatExchange(stock.exchange)}: {stock.symbol}
      </p>
      <h1 className={styles.name}>{stock.name}</h1>

      {latest ? (
        <>
          <div className={styles.heroRow}>
            <span className={styles.price}>${latest.price.toFixed(2)}</span>
            <span className={`${styles.change} ${changeClass}`}>
              {latest.changePct >= 0 ? '+' : ''}
              {latest.changePct.toFixed(2)}%
            </span>
            <span className={`${styles.sparkline} ${changeClass}`}>
              <PriceChart snapshots={stock.snapshots} width={100} height={32} strokeWidth={1.5} compact />
            </span>
          </div>
          <p className={styles.stale}>Updated {latest.timestamp.toLocaleString()}</p>
        </>
      ) : (
        <p className={styles.stale}>No data yet. Refresh to fetch the latest snapshot.</p>
      )}

      <div className={styles.actions}>
        <RefreshButton symbol={stock.symbol} />
      </div>

      {latest && (
        <dl className={styles.metrics}>
          <div className={styles.metricRow}>
            <dt className={styles.metricLabel}>P/E ratio</dt>
            <dd className={styles.metricValue}>{latest.peRatio?.toFixed(1) ?? '—'}</dd>
          </div>
          <div className={styles.metricRow}>
            <dt className={styles.metricLabel}>Market cap</dt>
            <dd className={styles.metricValue}>{latest.marketCap ?? '—'}</dd>
          </div>
          <div className={styles.metricRow}>
            <dt className={styles.metricLabel}>52-week range</dt>
            <dd className={styles.metricValue}>
              {latest.week52Low ?? '—'} – {latest.week52High ?? '—'}
            </dd>
          </div>
        </dl>
      )}

      {evaluation && <EvaluationPanel evaluation={evaluation} />}

      <p className={styles.newsTitle}>Recent news</p>
      <NewsList news={stock.news} />
    </>
  )
}

export default function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  return (
    <main className={styles.shell}>
      <Suspense fallback={<p className={styles.stale}>Loading stock…</p>}>
        <StockDetail paramsPromise={params} />
      </Suspense>
    </main>
  )
}
