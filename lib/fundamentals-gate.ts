export interface Fundamentals {
  // Percent change of the latest quarter over the same quarter a year before.
  epsGrowthQoq: number | null
  salesGrowthQoq: number | null
  // Return on equity, percent.
  roe: number | null
}

// The same cut-offs as the Finviz search in lib/finviz.ts: "over" means strictly above.
export const EPS_GROWTH_MIN = 25
export const SALES_GROWTH_MIN = 25
export const ROE_MIN = 15

export type FundamentalsState = 'pass' | 'fail' | 'unknown'

const CHECKS = [
  { key: 'epsGrowthQoq', min: EPS_GROWTH_MIN, label: 'utili per azione', signed: true },
  { key: 'salesGrowthQoq', min: SALES_GROWTH_MIN, label: 'ricavi', signed: true },
  { key: 'roe', min: ROE_MIN, label: 'ROE', signed: false },
] as const

function pct(v: number, signed: boolean): string {
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : ''
  return `${sign}${Math.abs(Math.round(v))}%`
}

// What falls short, as short phrases for the verdict text.
export function fundamentalsMisses(f: Fundamentals | null | undefined): string[] {
  if (!f) return []
  return CHECKS.flatMap((c) => {
    const v = f[c.key]
    return v !== null && v <= c.min ? [`${c.label} ${pct(v, c.signed)} (ne servono oltre ${c.min}%)`] : []
  })
}

// A measure that is missing is not held against the stock; with none at all there is nothing to judge.
export function fundamentalsState(f: Fundamentals | null | undefined): FundamentalsState {
  if (!f || CHECKS.every((c) => f[c.key] === null)) return 'unknown'
  return fundamentalsMisses(f).length > 0 ? 'fail' : 'pass'
}
