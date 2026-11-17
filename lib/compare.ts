import { prisma } from './db'
import { evaluateStock, type Evaluation } from './evaluate'
import { altmanZ, type AltmanResult } from './solidity'
import { getAnnualFinancials, type YearFinancials } from './fundamentals'
import { getMetrics } from './finnhub'
import { buildFairValueInput, fairValue, type FairValueInput } from './fair-value'

export interface ComparisonStock {
  stock: { symbol: string; name: string }
  latest: { price: number; changePct: number; marketCap: number | null } | null
  evaluation: Evaluation | null
  fairValueInput: FairValueInput | null
  altman: AltmanResult | null
  financials: YearFinancials[]
  insight: { summary: string; keyPoints: string[]; risks: string[]; verdict: string; generatedAt: Date } | null
}

export async function loadComparisonStock(symbol: string): Promise<ComparisonStock | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 2 },
      news: { orderBy: { publishedAt: 'desc' }, take: 20, include: { analysis: true } },
      recommendations: { orderBy: { period: 'desc' }, take: 6 },
      insight: true,
    },
  })
  if (!stock) return null

  const latest = stock.snapshots[0] ?? null

  const earliestSnapshot =
    stock.snapshots.length > 1
      ? await prisma.priceSnapshot.findFirst({
          where: { stockId: stock.id },
          orderBy: { timestamp: 'asc' },
        })
      : null

  const [financials, metrics] = await Promise.all([
    getAnnualFinancials(symbol),
    getMetrics(symbol).catch(() => null),
  ])

  const fairValueInput = latest && metrics ? buildFairValueInput(latest.price, metrics) : null

  const evaluation = latest
    ? evaluateStock({
        fairValue: fairValueInput ? fairValue(fairValueInput) : null,
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
        newsAnalyses: stock.news.flatMap((n) => (n.analysis ? [{ ...n.analysis, publishedAt: n.publishedAt }] : [])),
        recentRecommendations: stock.recommendations.slice(0, 2).map((r) => ({
          period: r.period,
          strongBuy: r.strongBuy,
          buy: r.buy,
          hold: r.hold,
          sell: r.sell,
          strongSell: r.strongSell,
        })),
      })
    : null

  const altman =
    financials.length > 0 && latest
      ? altmanZ(financials[financials.length - 1], latest.marketCap === null ? null : latest.marketCap * 1e6)
      : null


  return {
    stock: { symbol: stock.symbol, name: stock.name },
    latest: latest ? { price: latest.price, changePct: latest.changePct, marketCap: latest.marketCap } : null,
    evaluation,
    fairValueInput,
    altman,
    financials,
    insight: stock.insight,
  }
}

export async function selectComparableStocks(
  symbols: string[],
  loader: (symbol: string) => Promise<ComparisonStock | null> = loadComparisonStock
): Promise<ComparisonStock[]> {
  const loaded = await Promise.all(symbols.map(loader))
  return loaded.filter((s): s is ComparisonStock => s !== null)
}

export function parseCompareSymbols(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return []
  const seen = new Set<string>()
  for (const part of value.split(',')) {
    const symbol = part.trim().toUpperCase()
    if (symbol) seen.add(symbol)
    if (seen.size === 4) break
  }
  return [...seen]
}
