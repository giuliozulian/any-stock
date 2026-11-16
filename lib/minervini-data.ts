import { prisma } from '@/lib/db'
import { getDailyBars, type Bar } from '@/lib/history'
import { detectVcp, evaluateTrendTemplate, percentileRank, weightedReturn, type TrendTemplate, type Vcp } from '@/lib/minervini'

const MIN_PEERS = 5
const MAX_PEERS = 40

export interface MinerviniAnalysis {
  template: TrendTemplate
  vcp: Vcp
  peerCount: number
}

export function buildAnalysis(bars: Bar[], peerReturns: number[]): MinerviniAnalysis | null {
  const own = weightedReturn(bars.map((b) => b.close))
  const rs = own !== null && peerReturns.length >= MIN_PEERS ? percentileRank(own, peerReturns) : null
  const template = evaluateTrendTemplate(bars, rs)
  if (!template) return null
  return { template, vcp: detectVcp(bars), peerCount: peerReturns.length }
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
  const [bars, peers] = await Promise.all([getDailyBars(symbol), peerSymbols(symbol)])
  if (bars.length === 0) return null
  const returns = await Promise.all(peers.map(async (s) => weightedReturn((await getDailyBars(s)).map((b) => b.close))))
  return buildAnalysis(bars, returns.filter((r): r is number => r !== null))
}
