import type { Bar } from '@/lib/history'
import {
  BREAKOUT_VOLUME,
  MAX_CHASE,
  RS_MIN,
  RS_MIN_BARS,
  STOP_BELOW_PIVOT,
  TREND_TEMPLATE_LABELS,
  detectVcp,
  evaluateTrendTemplate,
  percentileRank,
  weightedReturn,
  type Criterion,
  type VcpStatus,
} from '@/lib/minervini'

// Same floor as the single-stock analysis: below five peers a percentile means nothing.
export const MIN_PEERS = 5

export interface ScanSymbolResult {
  price: number
  barDate: Date
  weightedReturn: number
  criteria: Criterion[]
  vcpStatus: VcpStatus | null
  pivot: number | null
  pivotDistancePct: number | null
  contractions: number[]
  volumeDryUp: boolean
  volumeRatio: number | null
}

// Everything that does not depend on the other stocks. Null when the history is too short to rank.
export function scanSymbol(bars: Bar[]): ScanSymbolResult | null {
  if (bars.length < RS_MIN_BARS) return null
  const closes = bars.map((b) => b.close)
  const ret = weightedReturn(closes)
  const template = evaluateTrendTemplate(bars, null)
  if (ret === null || !template) return null
  const vcp = detectVcp(bars)
  const last = bars[bars.length - 1]
  return {
    price: last.close,
    barDate: new Date(last.t),
    weightedReturn: ret,
    criteria: template.criteria.slice(0, 7),
    vcpStatus: vcp.status,
    pivot: vcp.pivot,
    pivotDistancePct: vcp.pivot === null ? null : (last.close / vcp.pivot - 1) * 100,
    contractions: vcp.contractions,
    volumeDryUp: vcp.volumeDryUp,
    volumeRatio: vcp.volumeRatio,
  }
}

export interface FinalizeInput {
  symbol: string
  weightedReturn: number
  criteria: Criterion[]
}

export interface FinalizeOutput {
  symbol: string
  rs: number | null
  passedCount: number
}

// Second pass: rank every stock against all the others, add the eighth criterion and count the passed ones out of eight.
export function finalize(rows: FinalizeInput[]): FinalizeOutput[] {
  return rows.map((row, i) => {
    const peers = rows.filter((_, j) => j !== i).map((r) => r.weightedReturn)
    const rs = peers.length >= MIN_PEERS ? percentileRank(row.weightedReturn, peers) : null
    const trend = row.criteria.filter((c) => c.ok).length
    return { symbol: row.symbol, rs, passedCount: trend + (rs !== null && rs >= RS_MIN ? 1 : 0) }
  })
}

// The label of the first criterion a 7-of-8 stock fails; the stored criteria hold only the first seven.
export function missingCriterion(criteria: Criterion[], rs: number | null): string | null {
  const failed = criteria.find((c) => !c.ok)
  if (failed) return failed.label
  return rs === null || rs < RS_MIN ? TREND_TEMPLATE_LABELS[7] : null
}

// Minervini's entry: all eight criteria, price breaking out of the base (up to 5% above the pivot) on strong volume.
export function isEntrySetup(r: { passedCount: number; vcpStatus: VcpStatus | null; volumeRatio: number | null }): boolean {
  return r.passedCount >= 8 && r.vcpStatus === 'breakout' && r.volumeRatio !== null && r.volumeRatio >= BREAKOUT_VOLUME
}

// Minervini aims to bank gains around 20-25% and to cut losses at 7-8%.
export const PROFIT_TARGET_MIN = 0.2
export const PROFIT_TARGET_MAX = 0.25

export type Verdict = 'buy' | 'confirm' | 'watch' | 'late' | 'broken' | 'no-base' | 'almost'

export interface PlanInput {
  passedCount: number
  vcpStatus: VcpStatus | null
  volumeRatio: number | null
  price: number
  pivot: number | null
}

export interface TradePlan {
  verdict: Verdict
  buyFrom: number | null
  buyTo: number | null
  stop: number | null
  riskPct: number | null
  profitFrom: number | null
  profitTo: number | null
}

const NO_PRICES = { buyFrom: null, buyTo: null, stop: null, riskPct: null, profitFrom: null, profitTo: null }

// What to do with a stock, in the method's own terms: where to buy, where to get out, where to take profit.
export function tradePlan(r: PlanInput): TradePlan {
  if (r.passedCount < 8) return { verdict: 'almost', ...NO_PRICES }
  if (r.vcpStatus === null || r.pivot === null) return { verdict: 'no-base', ...NO_PRICES }
  if (r.vcpStatus === 'failed') return { verdict: 'broken', ...NO_PRICES }
  if (r.vcpStatus === 'extended') return { verdict: 'late', ...NO_PRICES }

  const verdict: Verdict = r.vcpStatus === 'forming' ? 'watch' : r.volumeRatio !== null && r.volumeRatio >= BREAKOUT_VOLUME ? 'buy' : 'confirm'
  // Already breaking out: measure from what it costs now. Still below the pivot: from the pivot, the price it would be bought at.
  const reference = verdict === 'watch' ? r.pivot : r.price
  const stop = r.pivot * (1 - STOP_BELOW_PIVOT)
  return {
    verdict,
    buyFrom: r.pivot,
    buyTo: r.pivot * (1 + MAX_CHASE),
    stop,
    riskPct: ((reference - stop) / reference) * 100,
    profitFrom: reference * (1 + PROFIT_TARGET_MIN),
    profitTo: reference * (1 + PROFIT_TARGET_MAX),
  }
}
