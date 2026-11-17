import { describe, expect, it } from 'vitest'
import { compareEvents, quoteReaction, reactionPct, slotOf, surprise, tierOf, typicalMove } from '@/lib/earnings'
import type { EarningsEvent } from '@/lib/finnhub'

const event = (symbol: string, extra: Partial<EarningsEvent> = {}): EarningsEvent => ({ symbol, date: '2026-11-17', hour: null, epsEstimate: null, revenueEstimate: null, epsActual: null, revenueActual: null, ...extra })
const info = (marketCap: number | null, extra = {}) => ({ name: 'n', marketCap, price: null, changePct: null, time: null, ...extra })
// A bar at 15:00 UTC falls inside the New York session of that date.
const bar = (date: string, close: number) => ({ t: Date.parse(`${date}T15:00:00Z`), high: close, low: close, close, volume: 1 })

describe('slotOf', () => {
  it('keeps known slots and groups the rest', () => {
    expect(slotOf('amc')).toBe('amc')
    expect(slotOf('')).toBe('unknown')
    expect(slotOf(null)).toBe('unknown')
  })
})

describe('tierOf', () => {
  const watched = new Set(['MINE'])
  it('puts the watchlist first whatever the size', () => {
    expect(tierOf(event('MINE'), watched, info(1e6))).toBe('watch')
  })
  it('uses market cap when known', () => {
    expect(tierOf(event('A', { revenueEstimate: 9e9 }), watched, info(5e9))).toBe('minor')
    expect(tierOf(event('B'), watched, info(4e11))).toBe('big')
  })
  it('falls back to expected revenue without a market cap', () => {
    expect(tierOf(event('C', { revenueEstimate: 2e9 }), watched, undefined)).toBe('big')
    expect(tierOf(event('D', { revenueEstimate: 5e8 }), watched, undefined)).toBe('minor')
    expect(tierOf(event('E'), watched, info(null))).toBe('minor')
  })
})

describe('compareEvents', () => {
  it('orders watchlist, then bigger companies, then symbol', () => {
    const items = [
      { e: event('SMALL'), tier: 'minor' as const, cap: 1e8 },
      { e: event('BIG'), tier: 'big' as const, cap: 5e11 },
      { e: event('MINE'), tier: 'watch' as const, cap: 1e9 },
      { e: event('MID'), tier: 'big' as const, cap: 2e10 },
    ]
    expect(items.sort(compareEvents).map((i) => i.e.symbol)).toEqual(['MINE', 'BIG', 'MID', 'SMALL'])
  })
})

describe('surprise', () => {
  it('classifies against the estimate', () => {
    expect(surprise(1.2, 1)).toEqual({ pct: expect.closeTo(20), verdict: 'beat' })
    expect(surprise(0.8, 1)?.verdict).toBe('miss')
    expect(surprise(1.005, 1)?.verdict).toBe('inline')
    expect(surprise(-0.5, -1)?.verdict).toBe('beat')
  })
  it('handles a zero estimate and missing data', () => {
    expect(surprise(0.1, 0)).toEqual({ pct: null, verdict: 'beat' })
    expect(surprise(null, 1)).toBeNull()
    expect(surprise(1, null)).toBeNull()
  })
})

describe('reactionPct', () => {
  const bars = [bar('2026-11-12', 100), bar('2026-11-13', 110), bar('2026-11-16', 99)]
  it('uses the same session for reports before the open, the next one after the close', () => {
    expect(reactionPct(bars, '2026-11-13', 'bmo')).toBeCloseTo(10)
    expect(reactionPct(bars, '2026-11-13', 'amc')).toBeCloseTo(-10)
  })
  it('is null without the bars needed', () => {
    expect(reactionPct(bars, '2026-11-16', 'amc')).toBeNull()
    expect(reactionPct(bars, '2026-11-12', 'bmo')).toBeNull()
    expect(reactionPct(bars, '2026-11-14', 'bmo')).toBeNull()
  })
})

describe('quoteReaction', () => {
  const quote = (changePct: number | null, time: string) => ({ name: 'n', marketCap: null, price: null, changePct, time: Date.parse(time) })
  it('counts only when the quote is from the session that followed the report', () => {
    expect(quoteReaction({ date: '2026-11-17', hour: 'bmo' }, quote(5, '2026-11-17T20:00:00Z'))).toBe(5)
    expect(quoteReaction({ date: '2026-11-16', hour: 'amc' }, quote(-3, '2026-11-17T20:00:00Z'))).toBe(-3)
    // Friday after the close reacts on Monday, not on Saturday.
    expect(quoteReaction({ date: '2026-11-13', hour: 'amc' }, quote(4, '2026-11-16T20:00:00Z'))).toBe(4)
  })
  it('ignores a quote from another session or without data', () => {
    expect(quoteReaction({ date: '2026-11-17', hour: 'amc' }, quote(5, '2026-11-17T20:00:00Z'))).toBeNull()
    expect(quoteReaction({ date: '2026-11-16', hour: 'bmo' }, quote(5, '2026-11-17T20:00:00Z'))).toBeNull()
    expect(quoteReaction({ date: '2026-11-17', hour: 'bmo' }, undefined)).toBeNull()
    expect(quoteReaction({ date: '2026-11-17', hour: 'bmo' }, quote(null, '2026-11-17T20:00:00Z'))).toBeNull()
  })
})

describe('typicalMove', () => {
  it('averages the size of the latest four moves', () => {
    expect(typicalMove([5, -3, null, 4, -8, 50])).toBeCloseTo((5 + 3 + 4 + 8) / 4)
  })
  it('needs at least two data points', () => {
    expect(typicalMove([5, null])).toBeNull()
    expect(typicalMove([])).toBeNull()
  })
})
