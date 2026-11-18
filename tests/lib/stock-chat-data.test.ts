import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, watch } from '../helpers/db'
import { findEntry } from '@/lib/watchlist'

vi.mock('@/lib/finnhub', () => ({ getMetrics: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/insider-data', () => ({ getInsiderData: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/congress', () => ({ getCongressTrades: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/minervini-data', () => ({ getMinerviniAnalysis: vi.fn().mockResolvedValue(null) }))

import * as insiderData from '@/lib/insider-data'
import * as congress from '@/lib/congress'
import * as minervini from '@/lib/minervini-data'
import { loadStockChatInput } from '@/lib/stock-chat-data'

const NOW = new Date('2026-11-18T12:00:00Z')

async function entry() {
  const found = await findEntry('dev', 'AAPL')
  if (!found) throw new Error('missing entry')
  return found
}

describe('loadStockChatInput', () => {
  beforeEach(async () => {
    await resetDb()
    vi.clearAllMocks()
  })

  it('returns identity and nulls for a stock with no data yet', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    const input = await loadStockChatInput(await entry(), NOW)
    expect(input).toMatchObject({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', snapshot: null, evaluation: null, minervini: null, insiders: null, congress: null, news: [] })
  })

  it('maps the latest snapshot, news and earnings, and evaluates the stock', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', addedAt: new Date('2026-09-01T00:00:00Z') } })
    const stock = await prisma.stock.findUniqueOrThrow({ where: { symbol: 'AAPL' } })
    await prisma.stock.update({ where: { id: stock.id }, data: { nextEarningsDate: new Date('2026-12-02T00:00:00Z'), nextEarningsHour: 'amc', nextEarningsEpsEstimate: 1.62 } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 100, changePct: 1, timestamp: new Date('2026-09-02T00:00:00Z') } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 110, changePct: -2, peRatio: 25, timestamp: new Date('2026-11-17T00:00:00Z') } })
    await prisma.newsItem.create({ data: { stockId: stock.id, headline: 'Nuovo iPhone', url: 'https://x.example/1', source: 'Reuters', publishedAt: new Date('2026-11-16T00:00:00Z') } })

    const input = await loadStockChatInput(await entry(), NOW)
    expect(input.snapshot).toMatchObject({ price: 110, changePct: -2, peRatio: 25 })
    expect(input.news).toEqual([{ headline: 'Nuovo iPhone', source: 'Reuters', publishedAt: new Date('2026-11-16T00:00:00Z') }])
    expect(input.earnings).toEqual({ date: new Date('2026-12-02T00:00:00Z'), hour: 'amc', epsEstimate: 1.62 })
    expect(input.evaluation?.sinceWatching.pct).toBeCloseTo(10)
  })

  it('summarizes insiders and congress trades of the last 180 days only', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    vi.mocked(insiderData.getInsiderData).mockResolvedValue({
      sentiment: [],
      trades: [
        { name: 'A', side: 'sell', shares: 100, price: 10, value: 1000, date: '2026-10-01', filingDate: '2026-10-03' },
        { name: 'B', side: 'buy', shares: 50, price: 10, value: 500, date: '2025-01-01', filingDate: '2025-01-03' },
      ],
    })
    vi.mocked(congress.getCongressTrades).mockResolvedValue([
      { member: 'X', chamber: 'house', state: 'CA', side: 'buy', amountLow: 1, amountHigh: 2, date: '2026-10-10', disclosedAt: '2026-10-20' },
      { member: 'Y', chamber: 'senate', state: 'NY', side: 'sell', amountLow: 1, amountHigh: 2, date: '2024-01-10', disclosedAt: '2024-01-20' },
    ])
    const input = await loadStockChatInput(await entry(), NOW)
    expect(input.insiders).toMatchObject({ buys: 0, sells: 1, sellValue: 1000 })
    expect(input.congress).toEqual({ buys: 1, sells: 0 })
  })

  it('maps the Minervini analysis and survives a failing data source', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    vi.mocked(minervini.getMinerviniAnalysis).mockResolvedValue({
      template: { criteria: [{ id: 1, label: 'Prezzo sopra la SMA 200', ok: true, value: '', margin: null }], passedCount: 1, total: 1, passed: true, stage2: true, levels: [] },
      vcp: {} as never,
      peerCount: 10,
    })
    vi.mocked(insiderData.getInsiderData).mockRejectedValue(new Error('finnhub down'))
    const input = await loadStockChatInput(await entry(), NOW)
    expect(input.minervini).toEqual({ stage2: true, criteria: [{ label: 'Prezzo sopra la SMA 200', ok: true }] })
    expect(input.insiders).toBeNull()
  })
})
