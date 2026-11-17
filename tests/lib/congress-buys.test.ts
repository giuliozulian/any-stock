import { describe, it, expect } from 'vitest'
import { parseCongressBuys, clusterBuys } from '@/lib/congress'

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

  it('clusters tickers bought by several politicians, ranked by number of members', () => {
    const buys = parseCongressBuys({
      trades: [
        { ...row('A', 'ACM', '2026-11-05'), perf_pct: 10 },
        { ...row('B', 'ACM', '2026-11-06'), perf_pct: 20 },
        row('A', 'XYZ', '2026-11-07'),
        { ...row('A', 'XYZ', '2026-11-08'), transaction_date: '2026-11-02' },
      ],
    })
    const clusters = clusterBuys(buys)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toMatchObject({ ticker: 'ACM', members: ['B', 'A'], totalHigh: 30000, avgPerfPct: 15, lastDisclosedAt: '2026-11-06' })
  })
})

describe('congress sellers and filing links', () => {
  it('collects who sold each ticker, ignoring purchases', async () => {
    const { parseCongressSellers } = await import('@/lib/congress')
    const sellers = parseCongressSellers({ trades: [row('A', 'ACM', '2026-11-05', 'sale'), row('B', 'ACM', '2026-11-05', 'sale'), row('A', 'ACM', '2026-11-06', 'sale'), row('C', 'ACM', '2026-11-05')] })
    expect([...(sellers.get('ACM') ?? [])]).toEqual(['A', 'B'])
  })
  it('keeps only https filing links', () => {
    const buys = parseCongressBuys({ trades: [{ ...row('A', 'ACM', '2026-11-05'), filing_portal: 'https://disclosures-clerk.house.gov/x' }, { ...row('B', 'XYZ', '2026-11-05'), filing_portal: 'javascript:alert(1)' }] })
    expect(buys.find((b) => b.member === 'A')?.portal).toBe('https://disclosures-clerk.house.gov/x')
    expect(buys.find((b) => b.member === 'B')?.portal).toBeUndefined()
  })
})
