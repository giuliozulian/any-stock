import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as feed from '@/lib/edgar-form4-feed'
import * as insiderData from '@/lib/insider-data'
import * as quoteInfo from '@/lib/quote-info'
import { capBucket, getMarketClusters } from '@/lib/insider-clusters'

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
const buy = (name: string, date: string, value: number) => ({ name, side: 'buy' as const, shares: 100, price: value / 100, value, date, filingDate: date, role: 'Director' })

describe('capBucket', () => {
  it('splits large from 10 billion, mid from 2 billion, small below', () => {
    expect([capBucket(5e10), capBucket(1e10), capBucket(5e9), capBucket(2e9), capBucket(1e9)]).toEqual(['large', 'large', 'mid', 'mid', 'small'])
  })
})

describe('getMarketClusters', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('turns the market-wide seeds into clusters, best score first, dropping micro-caps and symbols whose trades show no cluster', async () => {
    vi.spyOn(feed, 'getForm4ClusterSeeds').mockResolvedValue([
      { symbol: 'BIG', name: 'Big', buyerCount: 3 },
      { symbol: 'LOW', name: 'Low', buyerCount: 2 },
      { symbol: 'MICRO', name: 'Micro', buyerCount: 4 },
      { symbol: 'NONE', name: 'None', buyerCount: 2 },
    ])
    vi.spyOn(quoteInfo, 'getQuoteInfo').mockResolvedValue(
      new Map([
        ['BIG', { name: 'Big Inc', marketCap: 5e10, price: 1, changePct: 0, time: null }],
        ['LOW', { name: 'Low Inc', marketCap: 3e9, price: 1, changePct: 0, time: null }],
        ['MICRO', { name: 'Micro Inc', marketCap: 5e7, price: 1, changePct: 0, time: null }],
        ['NONE', { name: 'None Inc', marketCap: 3e9, price: 1, changePct: 0, time: null }],
      ]),
    )
    const lookup = vi.spyOn(insiderData, 'getInsiderData').mockImplementation(async (symbol) => {
      if (symbol === 'BIG') return { trades: [buy('A', day(1), 2_000_000), buy('B', day(2), 1_000_000), buy('C', day(3), 500_000)], sentiment: [] }
      if (symbol === 'LOW') return { trades: [buy('A', day(20), 20_000), buy('B', day(21), 20_000)], sentiment: [] }
      return { trades: [buy('A', day(1), 1_000)], sentiment: [] }
    })

    const out = await getMarketClusters()

    expect(out.map((c) => c.symbol)).toEqual(['BIG', 'LOW'])
    expect(out[0]).toMatchObject({ name: 'Big Inc', marketCap: 5e10 })
    expect(out[0].cluster.insiders).toBe(3)
    expect(lookup).not.toHaveBeenCalledWith('MICRO')
  })

  it('returns an empty list when EDGAR gives no seed', async () => {
    // The previous result is cached for an hour: move past it.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 2 * 60 * 60 * 1000 })
    vi.spyOn(feed, 'getForm4ClusterSeeds').mockResolvedValue([])
    expect(await getMarketClusters()).toEqual([])
    vi.useRealTimers()
  })
})
