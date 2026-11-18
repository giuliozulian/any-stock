import { prisma } from '@/lib/db'
import { evaluateStock } from '@/lib/evaluate'
import { buildFairValueInput, fairValue } from '@/lib/fair-value'
import { getMetrics } from '@/lib/finnhub'
import { getCongressTrades } from '@/lib/congress'
import { getInsiderData } from '@/lib/insider-data'
import { daysAgoISO, summarizeTrades } from '@/lib/insiders'
import { getMinerviniAnalysis } from '@/lib/minervini-data'
import type { StockChatInput } from '@/lib/stock-chat-context'
import type { findEntry } from '@/lib/watchlist'

export type WatchedEntry = NonNullable<Awaited<ReturnType<typeof findEntry>>>

const RECENT_DAYS = 180

// Loads what the page shows for a watched stock, with the same functions. A failing source degrades to null instead of failing the chat.
export async function loadStockChatInput(entry: WatchedEntry, now = new Date()): Promise<StockChatInput> {
  const stock = entry.stock
  const [latest, firstSinceAdded, news, recommendations] = await Promise.all([
    prisma.priceSnapshot.findFirst({ where: { stockId: stock.id }, orderBy: { timestamp: 'desc' } }),
    prisma.priceSnapshot.findFirst({ where: { stockId: stock.id, timestamp: { gte: entry.addedAt } }, orderBy: { timestamp: 'asc' } }),
    prisma.newsItem.findMany({ where: { stockId: stock.id }, orderBy: { publishedAt: 'desc' }, take: 20, include: { analysis: true } }),
    prisma.analystRecommendation.findMany({ where: { stockId: stock.id }, orderBy: { period: 'desc' }, take: 6 }),
  ])
  const [metrics, insiderData, congressTrades, minervini] = await Promise.all([
    getMetrics(stock.symbol).catch(() => null),
    getInsiderData(stock.symbol).catch(() => null),
    getCongressTrades(stock.symbol).catch(() => null),
    getMinerviniAnalysis(stock.symbol).catch(() => null),
  ])

  const earliestSnapshot = firstSinceAdded && firstSinceAdded.id !== latest?.id ? firstSinceAdded : null
  const evaluation = latest
    ? evaluateStock({
        fairValue: metrics ? fairValue(buildFairValueInput(latest.price, metrics)) : null,
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
        newsAnalyses: news.flatMap((n) => (n.analysis ? [{ ...n.analysis, publishedAt: n.publishedAt }] : [])),
        recentRecommendations: recommendations.slice(0, 2).map((r) => ({
          period: r.period,
          strongBuy: r.strongBuy,
          buy: r.buy,
          hold: r.hold,
          sell: r.sell,
          strongSell: r.strongSell,
        })),
      })
    : null

  const since = daysAgoISO(RECENT_DAYS, now)
  const recentInsiders = insiderData ? insiderData.trades.filter((t) => t.date >= since) : null
  const recentCongress = congressTrades ? congressTrades.filter((t) => t.date >= since) : null

  return {
    symbol: stock.symbol,
    name: stock.name,
    exchange: stock.exchange,
    snapshot: latest
      ? {
          price: latest.price,
          changePct: latest.changePct,
          marketCap: latest.marketCap,
          peRatio: latest.peRatio,
          week52High: latest.week52High,
          week52Low: latest.week52Low,
          dividendYield: latest.dividendYield,
          payoutRatio: latest.payoutRatio,
          epsGrowth5Y: latest.epsGrowth5Y,
          timestamp: latest.timestamp,
        }
      : null,
    evaluation,
    minervini: minervini ? { stage2: minervini.template.stage2, criteria: minervini.template.criteria.map((c) => ({ label: c.label, ok: c.ok })) } : null,
    earnings: { date: stock.nextEarningsDate, hour: stock.nextEarningsHour, epsEstimate: stock.nextEarningsEpsEstimate },
    news: news.map((n) => ({ headline: n.headline, source: n.source, publishedAt: n.publishedAt })),
    insiders: recentInsiders ? summarizeTrades(recentInsiders) : null,
    congress: recentCongress ? { buys: recentCongress.filter((t) => t.side === 'buy').length, sells: recentCongress.filter((t) => t.side === 'sell').length } : null,
  }
}
