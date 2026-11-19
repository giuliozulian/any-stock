import { describe, expect, it } from 'vitest'
import { buildCluster, clusterScore, summarizeTrades, toTrades, topByActivity } from '@/lib/insiders'
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

describe('buildCluster', () => {
  const buy = (name: string, date: string, value: number, role: string | null = null) => ({ name, side: 'buy' as const, shares: 100, price: value / 100, value, date, filingDate: date, role })
  const now = new Date('2026-11-19T10:00:00Z')

  it('groups the buys of the 7 days ending on the latest one, with people, total and lead insider', () => {
    const c = buildCluster(
      [buy('Corbett', '2026-11-17', 91_000, 'CFO'), buy('Rosenthal', '2026-11-11', 186_000, 'Chief Operating Officer'), buy('Weisenburger', '2026-11-10', 1_980_000, 'Director'), buy('Old Timer', '2026-11-02', 500_000, 'Director')],
      now,
    )!
    expect(c).toMatchObject({ from: '2026-11-10', to: '2026-11-17', insiders: 3, purchases: 3, total: 2_257_000, lead: { name: 'Weisenburger', role: 'Director', value: 1_980_000 } })
    expect(c.trades.map((t) => t.name)).toEqual(['Corbett', 'Rosenthal', 'Weisenburger'])
  })

  it('adds up several purchases of the same person when picking the lead', () => {
    const c = buildCluster([buy('A', '2026-11-17', 100_000), buy('A', '2026-11-16', 100_000), buy('A', '2026-11-15', 100_000), buy('B', '2026-11-17', 250_000)], now)!
    expect(c.lead.name).toBe('A')
    expect(c.insiders).toBe(2)
    expect(c.purchases).toBe(4)
  })

  it('is not a cluster with a single buyer, sales only, or a last purchase older than 30 days', () => {
    expect(buildCluster([buy('A', '2026-11-17', 1), buy('A', '2026-11-16', 1)], now)).toBeNull()
    expect(buildCluster([{ ...buy('A', '2026-11-17', 1), side: 'sell' }, { ...buy('B', '2026-11-17', 1), side: 'sell' }], now)).toBeNull()
    expect(buildCluster([buy('A', '2026-09-01', 1), buy('B', '2026-09-02', 1)], now)).toBeNull()
    expect(buildCluster([], now)).toBeNull()
  })
})

describe('clusterScore', () => {
  it('rises with money, people, seniority and freshness, and stays within 0-100', () => {
    const base = { total: 200_000, insiders: 2, roles: ['Director'], ageDays: 10 }
    const s = clusterScore(base)
    expect(clusterScore({ ...base, total: 3_000_000 })).toBeGreaterThan(s)
    expect(clusterScore({ ...base, insiders: 4 })).toBeGreaterThan(s)
    expect(clusterScore({ ...base, roles: ['CEO'] })).toBeGreaterThan(s)
    expect(clusterScore({ ...base, ageDays: 1 })).toBeGreaterThan(s)
    const max = clusterScore({ total: 1e9, insiders: 20, roles: ['CEO'], ageDays: 0 })
    expect(max).toBeLessThanOrEqual(100)
    expect(clusterScore({ total: 0, insiders: 0, roles: [], ageDays: 99 })).toBe(0)
  })
})
