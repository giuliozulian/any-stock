import { describe, it, expect } from 'vitest'
import { bigMovers } from '@/lib/market'

describe('bigMovers', () => {
  it('keeps only moves of at least 15% either way, largest first', () => {
    const items = [
      { symbol: 'A', name: 'A', changePct: 5 },
      { symbol: 'B', name: 'B', changePct: -16 },
      { symbol: 'C', name: 'C', changePct: 15 },
      { symbol: 'D', name: 'D', changePct: 22 },
      { symbol: 'E', name: 'E', changePct: -14.9 },
    ]
    expect(bigMovers(items).map((i) => i.symbol)).toEqual(['D', 'B', 'C'])
  })
})

describe('getMarketBigMovers', () => {
  it('merges gainers and losers, drops duplicates, sub-$1 stocks and small moves', async () => {
    const { vi } = await import('vitest')
    const { getMarketBigMovers } = await import('@/lib/market')
    const q = (symbol: string, pct: number, price: number) => ({ symbol, shortName: symbol, regularMarketChangePercent: pct, regularMarketPrice: price })
    const bodies = [
      { finance: { result: [{ quotes: [q('UP', 30, 10), q('PENNY', 80, 0.5), q('SMALL', 6, 20)] }] } },
      { finance: { result: [{ quotes: [q('DOWN', -20, 5), q('UP', 30, 10)] }] } },
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve(bodies[i++]) })))
    const movers = await getMarketBigMovers()
    vi.unstubAllGlobals()
    expect(movers.map((m) => m.symbol)).toEqual(['UP', 'DOWN'])
  })
})
