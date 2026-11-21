import { prisma } from '@/lib/db'
import { getMetrics, type FinnhubMetrics } from '@/lib/finnhub'
import type { Fundamentals } from '@/lib/fundamentals-gate'
import { getDailyBars, type Bar } from '@/lib/history'
import { detectVcp, evaluateTrendTemplate, percentileRank, weightedReturn, type TrendTemplate, type Vcp } from '@/lib/minervini'

const MIN_PEERS = 5
const MAX_PEERS = 40

export interface MinerviniAnalysis {
  template: TrendTemplate
  vcp: Vcp
  peerCount: number
  // Latest-quarter growth and ROE, when Finnhub answered.
  fundamentals?: Fundamentals | null
  // Anchored VWAP of the base.
  avwap?: number | null
}

export function toAnalysisFundamentals(metrics: FinnhubMetrics | null): Fundamentals | null {
  if (!metrics) return null
  return { epsGrowthQoq: metrics.epsGrowthQuarterlyYoy ?? null, salesGrowthQoq: metrics.revenueGrowthQuarterlyYoy ?? null, roe: metrics.roe ?? null }
}

export function buildAnalysis(bars: Bar[], peerReturns: number[], fundamentals: Fundamentals | null = null): MinerviniAnalysis | null {
  const own = weightedReturn(bars.map((b) => b.close))
  const rs = own !== null && peerReturns.length >= MIN_PEERS ? percentileRank(own, peerReturns) : null
  const template = evaluateTrendTemplate(bars, rs)
  if (!template) return null
  const vcp = detectVcp(bars)
  return { template, vcp, peerCount: peerReturns.length, fundamentals, avwap: vcp.avwap }
}

async function peerSymbols(symbol: string): Promise<string[]> {
  const [watched, discovered] = await Promise.all([
    prisma.stock.findMany({ select: { symbol: true } }),
    prisma.discoveredCandidate.findMany({ where: { dismissedAt: null }, select: { symbol: true } }),
  ])
  const all = new Set([...watched, ...discovered].map((s) => s.symbol.toUpperCase()))
  all.delete(symbol.toUpperCase())
  return [...all].slice(0, MAX_PEERS)
}

export async function getMinerviniAnalysis(symbol: string): Promise<MinerviniAnalysis | null> {
  const [bars, peers, metrics] = await Promise.all([getDailyBars(symbol), peerSymbols(symbol), getMetrics(symbol.toUpperCase()).catch(() => null)])
  if (bars.length === 0) return null
  const returns = await Promise.all(peers.map(async (s) => weightedReturn((await getDailyBars(s)).map((b) => b.close))))
  return buildAnalysis(bars, returns.filter((r): r is number => r !== null), toAnalysisFundamentals(metrics))
}
