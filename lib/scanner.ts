import type { Bar } from '@/lib/history'
import {
  RS_MIN,
  RS_MIN_BARS,
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
