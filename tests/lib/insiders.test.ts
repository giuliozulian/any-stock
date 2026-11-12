import { describe, expect, it } from 'vitest'
import { summarizeTrades, toTrades, topByActivity } from '@/lib/insiders'
import type { InsiderTransaction } from '@/lib/finnhub'

function tx(over: Partial<InsiderTransaction>): InsiderTransaction {
  return { name: 'A', change: 100, share: 1000, price: 10, transactionDate: '2026-11-01', filingDate: '2026-11-03', code: 'P', ...over }
}

describe('toTrades', () => {
  it('keeps only P/S within the window, newest first', () => {
    const trades = toTrades([tx({ code: 'G' }), tx({ code: 'M' }), tx({ code: 'S', change: -50, transactionDate: '2026-11-05' }), tx({ transactionDate: '2026-01-01' }), tx({})], '2026-06-01')
    expect(trades.map((t) => [t.side, t.shares, t.date])).toEqual([
      ['sell', 50, '2026-11-05'],
      ['buy', 100, '2026-11-01'],
    ])
  })
})

describe('toTrades grouping', () => {
  it('merges same-person same-day same-side tranches with a weighted average price', () => {
    const trades = toTrades([tx({ code: 'S', change: -100, price: 10 }), tx({ code: 'S', change: -300, price: 20 }), tx({ code: 'S', change: -50, name: 'B' })], '2026-06-01')
    expect(trades).toHaveLength(2)
    const a = trades.find((t) => t.name === 'A')!
    expect(a).toMatchObject({ shares: 400, value: 7000, price: 17.5 })
  })
})

describe('summarizeTrades', () => {
  it('reports buying when purchases outweigh sales', () => {
    const s = summarizeTrades(toTrades([tx({ change: 1000 }), tx({ code: 'S', change: -100 })], '2026-06-01'))
    expect(s).toMatchObject({ buys: 1, sells: 1, netShares: 900, mood: 'buying' })
  })
  it('reports selling only when sales clearly dominate', () => {
    expect(summarizeTrades(toTrades([tx({ code: 'S', change: -1000 }), tx({ change: 100 })], '2026-06-01')).mood).toBe('selling')
    expect(summarizeTrades(toTrades([tx({ code: 'S', change: -150 }), tx({ change: 100 })], '2026-06-01')).mood).toBe('neutral')
  })
  it('is neutral with no trades', () => {
    expect(summarizeTrades([]).mood).toBe('neutral')
  })
})

describe('topByActivity', () => {
  it('ranks by trade count and returns at most 3 non-empty entries', () => {
    const mk = (symbol: string, n: number) => ({
      symbol,
      name: symbol,
      trades: toTrades(
        Array.from({ length: n }, (_, i) => tx({ name: `P${i}` })),
        '2026-06-01',
      ),
    })
    expect(topByActivity([mk('A', 1), mk('B', 4), mk('C', 0), mk('D', 2), mk('E', 3)]).map((e) => e.symbol)).toEqual(['B', 'E', 'D'])
  })
})

describe('parseCongressTrades', () => {
  it('keeps purchases and sales, drops duplicates and other types', async () => {
    const { parseCongressTrades } = await import('@/lib/congress')
    const row = { member: 'X', chamber: 'house', state: 'CA', type: 'purchase', amount_low: 1001, amount_high: 15000, transaction_date: '2026-10-01', disclosure_date: '2026-11-01' }
    const out = parseCongressTrades({ trades: [row, { ...row }, { ...row, type: 'sale', transaction_date: '2026-10-05' }, { ...row, type: 'exchange' }] })
    expect(out.map((t) => [t.side, t.date])).toEqual([
      ['sell', '2026-10-05'],
      ['buy', '2026-10-01'],
    ])
    expect(parseCongressTrades({ error: 'x' })).toEqual([])
  })
})

describe('toTrades without grouping', () => {
  it('keeps every filing as its own row', () => {
    expect(toTrades([tx({ code: 'S', change: -100, id: 'a' }), tx({ code: 'S', change: -300, id: 'b' })], '2026-06-01', false)).toHaveLength(2)
  })
})

describe('parseFmpTrades', () => {
  it('maps FMP rows to trades and drops other types', async () => {
    const { parseFmpTrades } = await import('@/lib/congress')
    const out = parseFmpTrades(
      [
        { firstName: 'Nancy', lastName: 'Pelosi', district: 'CA11', type: 'Purchase', amount: '$1,000,001 - $5,000,000', transactionDate: '2026-07-24', disclosureDate: '2026-08-24' },
        { firstName: 'A', lastName: 'B', type: 'Exchange', amount: '$1,001 - $15,000', transactionDate: '2026-07-01' },
      ],
      'house',
    )
    expect(out).toEqual([{ member: 'Nancy Pelosi', chamber: 'house', state: 'CA', side: 'buy', amountLow: 1000001, amountHigh: 5000000, date: '2026-07-24', disclosedAt: '2026-08-24' }])
  })
})
