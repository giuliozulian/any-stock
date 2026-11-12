import { describe, it, expect } from 'vitest'
import { parseCongressBuys, topBought } from '@/lib/congress'

const row = (member: string, ticker: string | undefined, disclosure: string, type = 'purchase') => ({
  member, ticker, type, chamber: 'house', state: 'CA', asset: `Acme Corp (${ticker}) [ST]`,
  amount_low: 1001, amount_high: 15000, transaction_date: '2026-11-01', disclosure_date: disclosure,
})

describe('congress buys', () => {
  it('keeps only purchases with a ticker, dedupes, sorts newest disclosure first and cleans asset names', () => {
    const buys = parseCongressBuys({
      trades: [row('A', 'ACM', '2026-11-05'), row('A', 'ACM', '2026-11-05'), row('B', 'XYZ', '2026-11-09'), row('C', undefined, '2026-11-10'), row('D', 'ACM', '2026-11-10', 'sale')],
    })
    expect(buys.map((b) => b.member)).toEqual(['B', 'A'])
    expect(buys[1].asset).toBe('Acme Corp')
  })

  it('ranks tickers by number of distinct members', () => {
    const buys = parseCongressBuys({ trades: [row('A', 'ACM', '2026-11-05'), row('B', 'ACM', '2026-11-06'), row('A', 'XYZ', '2026-11-07'), row('A', 'XYZ', '2026-11-08')] })
    const top = topBought(buys)
    expect(top[0]).toMatchObject({ ticker: 'ACM', members: 2 })
  })
})
