import type { PriceSnapshot } from '@prisma/client'
import { prisma } from './db'
import { getDailyBars } from './history'
import { getMetrics } from './finnhub'
import { buildFairValueInput, fairValue } from './fair-value'
import { evaluateStock, verdictTones, RULES_VERSION, type EvaluateInput } from './evaluate'
import { barDay } from './verdict-backtest'

export interface RecordResult {
  recorded: number
  skipped: number
  failed: number
}

// The same inputs the stock page feeds to evaluateStock, minus "since you follow", which is per user and not part of the verdict.
function evaluateInput(
  latest: PriceSnapshot,
  news: Array<{ publishedAt: Date; analysis: { direction: string; intensity: number; confidence: string } | null }>,
  recs: EvaluateInput['recentRecommendations'],
  metrics: Awaited<ReturnType<typeof getMetrics>> | null,
  now: Date,
): EvaluateInput {
  return {
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
    earliestSnapshot: null,
    newsAnalyses: news.flatMap((n) => (n.analysis ? [{ direction: n.analysis.direction, intensity: n.analysis.intensity, confidence: n.analysis.confidence, publishedAt: n.publishedAt }] : [])),
    recentRecommendations: recs,
    now,
  }
}

// Writes today's verdict for every stock someone watches. Running it twice the same day adds nothing.
export async function recordVerdicts(now = new Date()): Promise<RecordResult> {
  const day = now.toISOString().slice(0, 10)
  const stocks = await prisma.stock.findMany({ where: { watchers: { some: {} } }, select: { id: true, symbol: true } })
  const result: RecordResult = { recorded: 0, skipped: 0, failed: 0 }

  for (const stock of stocks) {
    try {
      const [latest, news, recs, bars, metrics] = await Promise.all([
        prisma.priceSnapshot.findFirst({ where: { stockId: stock.id }, orderBy: { timestamp: 'desc' } }),
        prisma.newsItem.findMany({ where: { stockId: stock.id }, orderBy: { publishedAt: 'desc' }, take: 20, include: { analysis: true } }),
        prisma.analystRecommendation.findMany({ where: { stockId: stock.id }, orderBy: { period: 'desc' }, take: 2 }),
        getDailyBars(stock.symbol),
        getMetrics(stock.symbol).catch(() => null),
      ])
      const last = bars[bars.length - 1]
      if (!latest || !last) {
        result.skipped++
        continue
      }

      const evaluation = evaluateStock(evaluateInput(latest, news, recs, metrics, now))
      const tones = verdictTones(evaluation)
      const created = await prisma.verdictLog.createMany({
        data: [
          {
            stockId: stock.id,
            day,
            refDate: barDay(last.t),
            refPrice: last.close,
            overall: tones.overall,
            score: tones.score,
            shortTerm: tones.shortTerm,
            shortTermLabel: evaluation.shortTerm.label,
            mediumTerm: tones.mediumTerm,
            mediumTermLabel: evaluation.mediumTerm.label,
            longTerm: tones.longTerm,
            longTermLabel: evaluation.longTerm.label,
            fairValue: tones.fairValue,
            fairValueNote: evaluation.fairValue.note,
            news: tones.news,
            newsNote: evaluation.newsImpact.note,
            rulesVersion: RULES_VERSION,
          },
        ],
        skipDuplicates: true,
      })
      result.recorded += created.count
    } catch (err) {
      console.error(`Verdict log failed for ${stock.symbol}:`, err instanceof Error ? err.message : err)
      result.failed++
    }
  }
  return result
}
