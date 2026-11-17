import { prisma } from './db'
import { analyzePendingNews } from './news-analysis'
import { refreshStockInsight } from './stock-insight'
import { refreshVerdictNote } from './verdict-note'
import { refreshEarningsNote } from './earnings-note'
import { refreshBullBearNote } from './bull-bear-note'
import { getQuote, getProfile, getMetrics, getCompanyNews, getRecommendationTrend, getNextEarnings } from './finnhub'
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

    // Finnhub answers 0 for unknown or delisted symbols: do not store it as a price.
    if (!(quote.currentPrice > 0)) throw new Error(`Nessun prezzo disponibile per ${symbol}`)

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
          where: { stockId_url: { stockId: stock.id, url: item.url } },
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
      await refreshStockInsight(stock.id)
    } catch (err) {
      logFailure('Stock insight', symbol, err)
    }

    try {
      const earnings = await getNextEarnings(symbol)
      await prisma.stock.update({
        where: { id: stock.id },
        data: {
          nextEarningsDate: earnings ? new Date(`${earnings.date}T00:00:00Z`) : null,
          nextEarningsHour: earnings?.hour ?? null,
          nextEarningsEpsEstimate: earnings?.epsEstimate ?? null,
          earningsCheckedAt: new Date(),
        },
      })
    } catch (err) {
      logFailure('Earnings refresh', symbol, err)
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

    try {
      await refreshVerdictNote(stock.id)
    } catch (err) {
      logFailure('Verdict note', symbol, err)
    }

    try {
      await refreshEarningsNote(stock.id)
    } catch (err) {
      logFailure('Earnings note', symbol, err)
    }

    try {
      await refreshBullBearNote(stock.id)
    } catch (err) {
      logFailure('Bull/bear note', symbol, err)
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

const STALE_AFTER_MS = 60 * 60 * 1000
const inFlight = new Map<string, Promise<RefreshResult>>()

const MAX_WAIT_MS = 4000

// Aggiorna notizie, riassunto e prezzi quando si apre la scheda, al massimo una volta all'ora per titolo.
export async function refreshStockIfStale(symbol: string): Promise<void> {
  const watched = await prisma.stock.findUnique({ where: { symbol }, select: { id: true } })
  if (!watched) return
  const last = await prisma.priceSnapshot.findFirst({
    where: { stock: { symbol } },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true },
  })
  if (last && Date.now() - last.timestamp.getTime() < STALE_AFTER_MS) return

  let run = inFlight.get(symbol)
  if (run) return
  if (!run) {
    run = refreshStock(symbol).finally(() => inFlight.delete(symbol))
    inFlight.set(symbol, run)
  }
  // Non blocchiamo la pagina su notizie e IA: dopo il tempo massimo il refresh continua in background.
  await Promise.race([run, new Promise<void>((resolve) => setTimeout(resolve, MAX_WAIT_MS))])
}
