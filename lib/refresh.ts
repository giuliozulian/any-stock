import { prisma } from './db'
import { getQuote, getProfile, getMetrics, getCompanyNews } from './finnhub'

export interface RefreshResult {
  symbol: string
  ok: boolean
  error?: string
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function refreshStock(symbol: string): Promise<RefreshResult> {
  try {
    const stock = await prisma.stock.findUniqueOrThrow({ where: { symbol } })

    const [quote, profile, metrics] = await Promise.all([
      getQuote(symbol),
      getProfile(symbol),
      getMetrics(symbol),
    ])

    await prisma.priceSnapshot.create({
      data: {
        stockId: stock.id,
        price: quote.currentPrice,
        changePct: quote.changePercent,
        marketCap: profile.marketCapitalization,
        peRatio: metrics.peRatio,
        week52High: metrics.week52High,
        week52Low: metrics.week52Low,
      },
    })

    const to = new Date()
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
    const news = await getCompanyNews(symbol, toDateString(from), toDateString(to))

    for (const item of news.slice(0, 10)) {
      await prisma.newsItem.upsert({
        where: { url: item.url },
        create: {
          stockId: stock.id,
          headline: item.headline,
          url: item.url,
          source: item.source,
          summary: item.summary,
          publishedAt: new Date(item.datetime * 1000),
        },
        update: {},
      })
    }

    return { symbol, ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Refresh failed for ${symbol}:`, message)
    return { symbol, ok: false, error: message }
  }
}

export async function refreshAllStocks(): Promise<RefreshResult[]> {
  const stocks = await prisma.stock.findMany()
  const results: RefreshResult[] = []
  for (const stock of stocks) {
    results.push(await refreshStock(stock.symbol))
  }
  return results
}
