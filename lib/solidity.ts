import type { YearFinancials } from './fundamentals'

export type AltmanZone = 'safe' | 'grey' | 'distress'

export interface AltmanResult {
  score: number
  zone: AltmanZone
}

// Altman Z-score for listed manufacturers. marketCap in USD. Returns null when an input is missing.
export function altmanZ(y: YearFinancials, marketCap: number | null): AltmanResult | null {
  const { totalAssets: ta, totalLiabilities: tl, currentAssets: ca, currentLiabilities: cl, retainedEarnings: re, operatingIncome: ebit, revenue } = y
  if (ta === null || ta <= 0 || tl === null || tl <= 0 || ca === null || cl === null || re === null || ebit === null || revenue === null || marketCap === null) return null
  const score = 1.2 * ((ca - cl) / ta) + 1.4 * (re / ta) + 3.3 * (ebit / ta) + 0.6 * (marketCap / tl) + 1.0 * (revenue / ta)
  return { score, zone: score > 2.99 ? 'safe' : score >= 1.81 ? 'grey' : 'distress' }
}

export interface PiotroskiCheck {
  label: string
  passed: boolean
}

export interface PiotroskiResult {
  score: number
  checks: PiotroskiCheck[]
}

// Piotroski F-score: 9 yes/no tests on profitability, leverage and efficiency, comparing a year with the previous one. Tests with missing data count as not passed.
export function piotroskiF(cur: YearFinancials, prev: YearFinancials): PiotroskiResult {
  const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b !== 0 ? a / b : null)
  const roa = (y: YearFinancials) => ratio(y.netIncome, y.totalAssets)
  const currentRatio = (y: YearFinancials) => ratio(y.currentAssets, y.currentLiabilities)
  const leverage = (y: YearFinancials) => ratio(y.longTermDebt, y.totalAssets)
  const margin = (y: YearFinancials) => ratio(y.grossProfit, y.revenue)
  const turnover = (y: YearFinancials) => ratio(y.revenue, y.totalAssets)
  const higher = (a: number | null, b: number | null) => a !== null && b !== null && a > b
  const lower = (a: number | null, b: number | null) => a !== null && b !== null && a < b
  const lowerOrEqual = (a: number | null, b: number | null) => a !== null && b !== null && a <= b

  const checks: PiotroskiCheck[] = [
    { label: 'Utile netto positivo', passed: cur.netIncome !== null && cur.netIncome > 0 },
    { label: 'Cassa operativa positiva', passed: cur.operatingCashFlow !== null && cur.operatingCashFlow > 0 },
    { label: 'Redditività degli attivi in crescita', passed: higher(roa(cur), roa(prev)) },
    { label: 'Cassa operativa maggiore dell’utile', passed: cur.operatingCashFlow !== null && cur.netIncome !== null && cur.operatingCashFlow > cur.netIncome },
    { label: 'Debito a lungo termine in calo (rispetto agli attivi)', passed: lower(leverage(cur), leverage(prev)) },
    { label: 'Liquidità corrente in crescita', passed: higher(currentRatio(cur), currentRatio(prev)) },
    { label: 'Nessuna nuova azione emessa', passed: lowerOrEqual(cur.shares, prev.shares) },
    { label: 'Margine lordo in crescita', passed: higher(margin(cur), margin(prev)) },
    { label: 'Ricavi per dollaro di attivi in crescita', passed: higher(turnover(cur), turnover(prev)) },
  ]
  return { score: checks.filter((c) => c.passed).length, checks }
}
