import { describe, expect, it, vi } from 'vitest'
import type { FinnhubMetrics } from '@/lib/finnhub'
import { FUNDAMENTALS_MAX, fetchFundamentals, toFundamentals } from '@/lib/scan-fundamentals'

const metrics = (over: Partial<FinnhubMetrics> = {}): FinnhubMetrics => ({
  peRatio: null, week52High: null, week52Low: null, pegRatio: null, roe: 20, netMargin: null, debtToEquity: null,
  dividendYield: null, payoutRatio: null, relativePerf13W: null, epsTTM: null, epsGrowth5Y: null,
  epsGrowthQuarterlyYoy: 40, revenueGrowthQuarterlyYoy: 30, ...over,
})

describe('toFundamentals', () => {
  it('maps the Finnhub fields and keeps missing ones as null', () => {
    expect(toFundamentals(metrics())).toEqual({ epsGrowthQoq: 40, salesGrowthQoq: 30, roe: 20 })
    expect(toFundamentals(metrics({ roe: null, epsGrowthQuarterlyYoy: undefined }))).toEqual({ epsGrowthQoq: null, salesGrowthQoq: 30, roe: null })
  })
})

describe('fetchFundamentals', () => {
  it('returns the fundamentals of every symbol it could read', async () => {
    const fetchMetrics = vi.fn(async (s: string) => metrics({ roe: s === 'AAA' ? 20 : 30 }))
    const out = await fetchFundamentals(['AAA', 'BBB'], 10_000, { fetchMetrics })
    expect(out.get('AAA')).toEqual({ epsGrowthQoq: 40, salesGrowthQoq: 30, roe: 20 })
    expect(out.get('BBB')?.roe).toBe(30)
  })

  it('leaves out a symbol whose fetch fails, and keeps the others', async () => {
    const fetchMetrics = vi.fn(async (s: string) => {
      if (s === 'BAD') throw new Error('429')
      return metrics()
    })
    const out = await fetchFundamentals(['AAA', 'BAD', 'CCC'], 10_000, { fetchMetrics })
    expect([...out.keys()].sort()).toEqual(['AAA', 'CCC'])
  })

  it('stops fetching when the time budget is over', async () => {
    let clock = 0
    const fetchMetrics = vi.fn(async () => {
      clock += 4000
      return metrics()
    })
    const out = await fetchFundamentals(['A', 'B', 'C', 'D', 'E', 'F'], 10_000, { fetchMetrics, now: () => clock, concurrency: 1 })
    expect(fetchMetrics).toHaveBeenCalledTimes(3)
    expect(out.size).toBe(3)
  })

  it('does nothing with no budget or no symbols', async () => {
    const fetchMetrics = vi.fn(async () => metrics())
    expect((await fetchFundamentals(['A'], 0, { fetchMetrics })).size).toBe(0)
    expect((await fetchFundamentals([], 10_000, { fetchMetrics })).size).toBe(0)
    expect(fetchMetrics).not.toHaveBeenCalled()
  })

  it(`reads at most ${FUNDAMENTALS_MAX} symbols`, async () => {
    const fetchMetrics = vi.fn(async () => metrics())
    const symbols = Array.from({ length: FUNDAMENTALS_MAX + 10 }, (_, i) => `S${i}`)
    expect((await fetchFundamentals(symbols, 10_000, { fetchMetrics })).size).toBe(FUNDAMENTALS_MAX)
  })
})
