import { describe, it, expect } from 'vitest'
import { lagDays, rankSignals, timingOf, topMembers } from '@/lib/congress-signals'
import type { CongressBuy } from '@/lib/congress'

const buy = (o: Partial<CongressBuy>): CongressBuy => ({ member: 'A', chamber: 'house', state: 'CA', side: 'buy', amountLow: 15_001, amountHigh: 50_000, date: '2026-05-01', disclosedAt: '2026-05-10', ticker: 'X', asset: 'X Inc', perfPct: 2, ...o })
const now = new Date('2026-05-12T00:00:00Z').getTime()

describe('congress signals', () => {
  it('classifies timing by performance since purchase', () => {
    expect([timingOf(null), timingOf(3), timingOf(10), timingOf(25)]).toEqual(['unknown', 'early', 'running', 'late'])
  })

  it('ranks a multi-buyer early ticker above a stock that already ran', () => {
    const buys = [buy({ member: 'A' }), buy({ member: 'B' }), buy({ ticker: 'Y', member: 'C' }), buy({ ticker: 'Y', member: 'D', perfPct: 40 })]
    const r = rankSignals(buys, new Map(), new Map(), now)
    expect(r.map((s) => s.ticker)).toEqual(['X', 'Y'])
    expect(r[0].timing).toBe('early')
    expect(r[1].timing).toBe('late')
  })

  it('drops small single-buyer tickers', () => {
    expect(rankSignals([buy({ amountLow: 1_001, amountHigh: 15_000 })], new Map(), new Map(), now)).toEqual([])
  })

  it('lists members with enough purchases, best performance first', () => {
    const stats = new Map([
      ['A', { purchases: 5, tickers: 3, avgPerfPct: 4, avgExcessPct: null }],
      ['B', { purchases: 3, tickers: 2, avgPerfPct: 12, avgExcessPct: null }],
      ['C', { purchases: 1, tickers: 1, avgPerfPct: 50, avgExcessPct: null }],
    ])
    expect(topMembers(stats).map((m) => m.member)).toEqual(['B', 'A'])
  })
})

describe('sells, lag and benchmark', () => {
  const now = Date.parse('2026-05-12T00:00:00Z')
  it('penalises a stock that other members are selling and says so', () => {
    const buys = [buy({ member: 'A' }), buy({ member: 'B' })]
    const plain = rankSignals(buys, new Map(), new Map(), now)[0]
    const sold = rankSignals(buys, new Map(), new Map(), now, new Map([['X', new Set(['C', 'D', 'A'])]]))[0]
    expect(sold.sellers).toBe(2)
    expect(sold.score).toBe(plain.score - 2)
    expect(sold.reasons).toContain('2 altri politici hanno venduto')
  })
  it('averages the return above the market and reports the longest filing delay', () => {
    const buys = [buy({ member: 'A', perfPct: 10, marketPct: 4, date: '2026-05-01', disclosedAt: '2026-05-10' }), buy({ member: 'B', perfPct: 6, marketPct: 4, date: '2026-04-01', disclosedAt: '2026-05-10' })]
    const s = rankSignals(buys, new Map(), new Map(), now)[0]
    expect(s.avgExcessPct).toBe(4)
    expect(s.maxLagDays).toBe(39)
  })
  it('measures the delay between trade and filing', () => {
    expect(lagDays({ date: '2026-05-01', disclosedAt: '2026-05-10' })).toBe(9)
    expect(lagDays({ date: '2026-05-01', disclosedAt: '' })).toBeNull()
  })
  it('ranks members by return above the market when it is known', () => {
    const stats = new Map([
      ['A', { purchases: 4, tickers: 2, avgPerfPct: 30, avgExcessPct: 2 }],
      ['B', { purchases: 4, tickers: 2, avgPerfPct: 10, avgExcessPct: 8 }],
    ])
    expect(topMembers(stats).map((m) => m.member)).toEqual(['B', 'A'])
  })
})

describe('daysSince', () => {
  it('counts whole days between a date and now', async () => {
    const { daysSince } = await import('@/lib/congress-signals')
    expect(daysSince('2026-11-01', Date.parse('2026-11-11T08:00:00Z'))).toBe(10)
  })
})
