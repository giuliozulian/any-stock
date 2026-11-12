export interface FairValueInput {
  price: number
  epsTTM: number | null
  bookValuePerShare: number | null
  cashFlowPerShare: number | null
  epsGrowth5Y: number | null
  dividendYield: number | null
}

export interface FairValueModel {
  key: 'graham-number' | 'graham-growth' | 'lynch' | 'cash-flow'
  label: string
  value: number
}

export interface FairValueResult {
  models: FairValueModel[]
  average: number
  premiumPct: number
}

const AAA_YIELD = 4.5
const DISCOUNT_RATE = 0.09
const TERMINAL_GROWTH = 0.025
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function cashFlowValue(cfps: number, growthPct: number): number {
  const g = clamp(growthPct, 3, 12) / 100
  let value = 0
  let cf = cfps
  for (let year = 1; year <= 10; year++) {
    cf *= 1 + g
    value += cf / (1 + DISCOUNT_RATE) ** year
  }
  const terminal = (cf * (1 + TERMINAL_GROWTH)) / (DISCOUNT_RATE - TERMINAL_GROWTH)
  return value + terminal / (1 + DISCOUNT_RATE) ** 10
}

// Average of several textbook models (Graham, Lynch, discounted cash flow), each applied only when its inputs make sense; needs at least two.
export function fairValue(input: FairValueInput): FairValueResult | null {
  const { price, epsTTM: eps, bookValuePerShare: bvps, cashFlowPerShare: cfps, dividendYield } = input
  const growth = clamp(input.epsGrowth5Y ?? 0, 0, 15)
  const models: FairValueModel[] = []

  if (eps !== null && eps > 0 && bvps !== null && bvps > 0) models.push({ key: 'graham-number', label: 'Numero di Graham', value: Math.sqrt(22.5 * eps * bvps) })
  if (eps !== null && eps > 0) models.push({ key: 'graham-growth', label: 'Graham con crescita', value: (eps * (8.5 + 2 * growth) * 4.4) / AAA_YIELD })
  if (eps !== null && eps > 0 && growth > 0) models.push({ key: 'lynch', label: 'Peter Lynch', value: eps * clamp(growth + (dividendYield ?? 0), 0, 25) })
  if (cfps !== null && cfps > 0) models.push({ key: 'cash-flow', label: 'Flussi di cassa scontati', value: cashFlowValue(cfps, input.epsGrowth5Y ?? 0) })

  if (models.length < 2 || !(price > 0)) return null
  const average = models.reduce((sum, m) => sum + m.value, 0) / models.length
  return { models, average, premiumPct: ((price - average) / average) * 100 }
}
