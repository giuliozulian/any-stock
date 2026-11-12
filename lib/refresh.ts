import { prisma } from './db'
import { analyzePendingNews } from './news-analysis'
import { getQuote, getProfile, getMetrics, getCompanyNews, getRecommendationTrend } from './finnhub'
import { notifyTargets } from './alert-runner'

export interface RefreshResult {
  symbol: string
  ok: boolean
  error?: string
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function logFailure(context: string, symbol: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`${context} failed for ${symbol}:`, message)
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
        pegRatio: metrics.pegRatio,
        roe: metrics.roe,
        netMargin: metrics.netMargin,
        debtToEquity: metrics.debtToEquity,
        dividendYield: metrics.dividendYield,
        payoutRatio: metrics.payoutRatio,
        relativePerf13W: metrics.relativePerf13W,
        epsTTM: metrics.epsTTM,
        epsGrowth5Y: metrics.epsGrowth5Y,
      },
    })

    try {
      await notifyTargets(stock, quote.currentPrice)
    } catch (err) {
      logFailure('Price alerts', symbol, err)
    }

    try {
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
    } catch (err) {
      logFailure('News refresh', symbol, err)
    }

    try {
      await analyzePendingNews(stock.id)
    } catch (err) {
      logFailure('News analysis', symbol, err)
    }

    try {
      const recommendations = await getRecommendationTrend(symbol)

      for (const rec of recommendations) {
        await prisma.analystRecommendation.upsert({
          where: { stockId_period: { stockId: stock.id, period: new Date(rec.period) } },
          create: {
            stockId: stock.id,
            period: new Date(rec.period),
            strongBuy: rec.strongBuy,
            buy: rec.buy,
            hold: rec.hold,
            sell: rec.sell,
            strongSell: rec.strongSell,
          },
          update: {
            strongBuy: rec.strongBuy,
            buy: rec.buy,
            hold: rec.hold,
            sell: rec.sell,
            strongSell: rec.strongSell,
          },
        })
      }
    } catch (err) {
      logFailure('Recommendation refresh', symbol, err)
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
