import { getMetrics, type FinnhubMetrics } from '@/lib/finnhub'
import type { Fundamentals } from '@/lib/fundamentals-gate'

export const FUNDAMENTALS_CONCURRENCY = 5
// Finnhub's free plan allows 60 calls a minute: a scan has a few dozen stocks with a base, never hundreds.
export const FUNDAMENTALS_MAX = 40

export function toFundamentals(m: FinnhubMetrics): Fundamentals {
  return { epsGrowthQoq: m.epsGrowthQuarterlyYoy ?? null, salesGrowthQoq: m.revenueGrowthQuarterlyYoy ?? null, roe: m.roe ?? null }
}

export interface FundamentalsDeps {
  fetchMetrics?: (symbol: string) => Promise<FinnhubMetrics>
  now?: () => number
  concurrency?: number
}

// Latest-quarter growth and ROE of each symbol, within the time budget. A symbol that cannot be read is simply absent:
// the verdict does not hold missing data against the stock.
export async function fetchFundamentals(symbols: string[], budgetMs: number, deps: FundamentalsDeps = {}): Promise<Map<string, Fundamentals>> {
  const fetchMetrics = deps.fetchMetrics ?? getMetrics
  const now = deps.now ?? Date.now
  const deadline = now() + budgetMs
  const queue = symbols.slice(0, FUNDAMENTALS_MAX)
  const out = new Map<string, Fundamentals>()
  let next = 0
  const worker = async () => {
    while (next < queue.length && now() < deadline) {
      const symbol = queue[next++]
      try {
        out.set(symbol, toFundamentals(await fetchMetrics(symbol)))
      } catch {
        // Left out: no data is not a failure of the scan.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? FUNDAMENTALS_CONCURRENCY, queue.length) }, worker))
  return out
}
