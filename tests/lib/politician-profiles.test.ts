import { describe, it, expect } from 'vitest'
import { memberStats, parseProfiles } from '@/lib/politician-profiles'
import type { CongressBuy } from '@/lib/congress'

const buy = (member: string, ticker: string, perfPct: number | null) =>
  ({ member, ticker, perfPct, chamber: 'house', state: 'CA', side: 'buy', amountLow: 1, amountHigh: 2, date: '', disclosedAt: '', asset: '' }) as unknown as CongressBuy

describe('memberStats', () => {
  it('counts purchases, distinct tickers and averages the known performance', () => {
    const stats = memberStats([buy('A', 'X', 10), buy('A', 'Y', null), buy('A', 'X', 20)])
    expect(stats.get('A')).toEqual({ purchases: 3, tickers: 2, avgPerfPct: 15 })
  })
})

describe('parseProfiles', () => {
  it('keeps valid profiles and drops unknown influence values', () => {
    const map = parseProfiles({ profiles: [{ name: 'A', party: 'Democratico', role: 'r', influence: 'enorme', note: 'n' }, { role: 'no name' }] })
    expect(map.size).toBe(1)
    expect(map.get('A')?.influence).toBe('')
  })
})
