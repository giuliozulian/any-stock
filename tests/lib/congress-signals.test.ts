import { describe, it, expect } from 'vitest'
import { rankSignals, timingOf, topMembers } from '@/lib/congress-signals'
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
      ['A', { purchases: 5, tickers: 3, avgPerfPct: 4 }],
      ['B', { purchases: 3, tickers: 2, avgPerfPct: 12 }],
      ['C', { purchases: 1, tickers: 1, avgPerfPct: 50 }],
    ])
    expect(topMembers(stats).map((m) => m.member)).toEqual(['B', 'A'])
  })
})
