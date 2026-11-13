import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import * as fundamentals from '@/lib/fundamentals'
import { resetDb } from '../helpers/db'
import { parseCompareSymbols, loadComparisonStock, selectComparableStocks } from '@/lib/compare'

describe('parseCompareSymbols', () => {
  it('uppercases and dedups symbols from a CSV string', () => {
    expect(parseCompareSymbols('aapl,MSFT,aapl')).toEqual(['AAPL', 'MSFT'])
  })

  it('clamps to the first 4 symbols', () => {
    expect(parseCompareSymbols('AAPL,MSFT,GOOGL,NVDA,TSLA')).toEqual(['AAPL', 'MSFT', 'GOOGL', 'NVDA'])
  })

  it('drops empty entries from stray commas', () => {
    expect(parseCompareSymbols('AAPL,,MSFT,')).toEqual(['AAPL', 'MSFT'])
  })

  it('returns an empty array for undefined or empty input', () => {
    expect(parseCompareSymbols(undefined)).toEqual([])
    expect(parseCompareSymbols('')).toEqual([])
  })

  it('takes the first value when Next.js passes a string array (repeated query key)', () => {
    expect(parseCompareSymbols(['AAPL,MSFT', 'GOOGL'])).toEqual(['AAPL', 'MSFT'])
  })
})

describe('loadComparisonStock', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('returns null for a symbol not in the watchlist', async () => {
    const result = await loadComparisonStock('ZZZZ')
    expect(result).toBeNull()
  })

  it('loads a stock with full data', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({
      data: {
        stockId: stock.id,
        price: 150,
        changePct: 1.1,
        marketCap: 3_000_000,
        week52High: 180,
        week52Low: 120,
        pegRatio: 1.4,
        roe: 22.5,
        debtToEquity: 0.8,
        epsTTM: 6.4,
        epsGrowth5Y: 12.5,
      },
    })
    await prisma.stockInsight.create({
      data: { stockId: stock.id, summary: 'Riassunto.', verdict: 'positive', score: 4, keyPoints: ['A'], risks: ['B'], confidence: 'high', inputHash: 'h', model: 'gemini' },
    })
    vi.spyOn(fundamentals, 'getAnnualFinancials').mockResolvedValue([
      { year: 2025, revenue: 400_000, grossProfit: 180_000, operatingIncome: 120_000, netIncome: 95_000, eps: 6.1, operatingCashFlow: 110_000, totalAssets: 350_000, totalLiabilities: 280_000, currentAssets: 140_000, currentLiabilities: 120_000, retainedEarnings: 50_000, longTermDebt: 90_000, shares: 15_000 },
    ])
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({
      peRatio: 28, week52High: 180, week52Low: 120, pegRatio: 1.4, roe: 22.5, netMargin: 25, debtToEquity: 0.8, dividendYield: 0.5, payoutRatio: 10, relativePerf13W: 2, epsTTM: 6.4, epsGrowth5Y: 12.5, bookValuePerShare: 4.2, cashFlowPerShare: 7.1,
    })

    const result = await loadComparisonStock('AAPL')

    expect(result?.stock.symbol).toBe('AAPL')
    expect(result?.evaluation?.targetPrice.value).not.toBeNull()
    expect(result?.insight?.summary).toBe('Riassunto.')
    expect(result?.altman).not.toBeNull()
  })

  it('loads a freshly-added stock with partial data without throwing', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'IPO1', name: 'New Co.', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 10, changePct: 0 } })
    vi.spyOn(fundamentals, 'getAnnualFinancials').mockResolvedValue([])
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(null as unknown as Awaited<ReturnType<typeof finnhub.getMetrics>>)

    const result = await loadComparisonStock('IPO1')

    expect(result?.stock.symbol).toBe('IPO1')
    expect(result?.insight).toBeNull()
    expect(result?.altman).toBeNull()
    expect(result?.evaluation?.sinceWatching.pct).toBeNull()
  })

  it('does not fail the whole load when getMetrics rejects', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 300, changePct: 0.5 } })
    vi.spyOn(fundamentals, 'getAnnualFinancials').mockResolvedValue([])
    vi.spyOn(finnhub, 'getMetrics').mockRejectedValue(new Error('rate limited'))

    const result = await loadComparisonStock('MSFT')

    expect(result?.stock.symbol).toBe('MSFT')
    expect(result?.fairValueInput).toBeNull()
  })

  it('feeds analyst recommendations into the evaluation, same as the detail page', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'NVDA', name: 'Nvidia', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 500, changePct: 0.2 } })
    await prisma.analystRecommendation.create({
      data: { stockId: stock.id, period: new Date('2026-10-01'), strongBuy: 10, buy: 20, hold: 5, sell: 1, strongSell: 0 },
    })
    vi.spyOn(fundamentals, 'getAnnualFinancials').mockResolvedValue([])
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(null as unknown as Awaited<ReturnType<typeof finnhub.getMetrics>>)

    const result = await loadComparisonStock('NVDA')

    expect(result?.evaluation?.mediumTerm.label).toBe('Consenso positivo')
  })

  it('uses the oldest snapshot for since-watching, not the second-newest', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'META', name: 'Meta', exchange: 'NASDAQ' } })
    const oldest = new Date('2026-01-01')
    const middle = new Date('2026-06-01')
    const newest = new Date('2026-11-01')
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 100, changePct: 0, timestamp: oldest } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 150, changePct: 0, timestamp: middle } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 200, changePct: 0, timestamp: newest } })
    vi.spyOn(fundamentals, 'getAnnualFinancials').mockResolvedValue([])
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(null as unknown as Awaited<ReturnType<typeof finnhub.getMetrics>>)

    const result = await loadComparisonStock('META')

    expect(result?.evaluation?.sinceWatching.sinceDate).toEqual(oldest)
  })
})

describe('selectComparableStocks', () => {
  it('returns all stocks when every symbol loads', async () => {
    const loader = vi.fn(async (symbol: string) => ({ stock: { symbol, name: symbol }, latest: null, evaluation: null, fairValueInput: null, altman: null, financials: [], insight: null }))
    const result = await selectComparableStocks(['AAPL', 'MSFT'], loader)
    expect(result.map((r) => r.stock.symbol)).toEqual(['AAPL', 'MSFT'])
  })

  it('drops an unknown symbol while keeping the others', async () => {
    const loader = vi.fn(async (symbol: string) => (symbol === 'ZZZZ' ? null : { stock: { symbol, name: symbol }, latest: null, evaluation: null, fairValueInput: null, altman: null, financials: [], insight: null }))
    const result = await selectComparableStocks(['AAPL', 'ZZZZ', 'MSFT'], loader)
    expect(result.map((r) => r.stock.symbol)).toEqual(['AAPL', 'MSFT'])
  })

  it('returns an empty array when every symbol is unknown', async () => {
    const loader = vi.fn(async () => null)
    const result = await selectComparableStocks(['ZZZZ', 'YYYY'], loader)
    expect(result).toEqual([])
  })
})
