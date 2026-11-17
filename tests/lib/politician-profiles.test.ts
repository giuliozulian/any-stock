import { describe, it, expect, vi, beforeEach } from 'vitest'
import { memberStats, getMemberProfiles } from '@/lib/politician-profiles'
import * as legislators from '@/lib/legislators'
import type { CongressBuy } from '@/lib/congress'

const buy = (member: string, ticker: string, perfPct: number | null) =>
  ({ member, ticker, perfPct, chamber: 'house', state: 'CA', side: 'buy', amountLow: 1, amountHigh: 2, date: '', disclosedAt: '', asset: '' }) as unknown as CongressBuy

describe('memberStats', () => {
  it('counts purchases, distinct tickers and averages the known performance', () => {
    const stats = memberStats([buy('A', 'X', 10), buy('A', 'Y', null), buy('A', 'X', 20)])
    expect(stats.get('A')).toEqual({ purchases: 3, tickers: 2, avgPerfPct: 15, avgExcessPct: null })
  })
})

describe('memberStats against the market', () => {
  it('averages the return above the S&P 500 only where the benchmark is known', () => {
    const stats = memberStats([{ ...buy('A', 'X', 10), marketPct: 4 }, { ...buy('A', 'Y', 6), marketPct: 8 }, buy('A', 'Z', 50)])
    expect(stats.get('A')?.avgExcessPct).toBe(2)
  })
})

describe('getMemberProfiles', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('builds profiles from the public dataset and skips members it cannot match', async () => {
    vi.spyOn(legislators, 'getLegislators').mockResolvedValue(
      legislators.buildLegislators(
        [{ id: { bioguide: 'K1' }, name: { first: 'Ro', last: 'Khanna', official_full: 'Ro Khanna' }, terms: [{ type: 'rep', state: 'CA', district: 17, party: 'Democrat' }] }],
        [{ thomas_id: 'HSAS', name: 'House Committee on Armed Services' }],
        { HSAS: [{ bioguide: 'K1' }] }
      )
    )
    const out = await getMemberProfiles([
      { member: 'Rohit Khanna', chamber: 'house', state: 'CA17' },
      { member: 'Nobody Known', chamber: 'house', state: 'TX01' },
    ])
    expect(out.get('Rohit Khanna')).toEqual({ party: 'Democratico', role: 'Deputato, commissioni: Armed Services', influence: 'alta', note: '' })
    expect(out.has('Nobody Known')).toBe(false)
  })

  it('returns nothing when the dataset is unavailable', async () => {
    vi.spyOn(legislators, 'getLegislators').mockResolvedValue(null)
    expect((await getMemberProfiles([{ member: 'A', chamber: 'house', state: 'CA17' }])).size).toBe(0)
  })
})
