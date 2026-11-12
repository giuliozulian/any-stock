import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import { resetDb } from '../helpers/db'
import { refreshStock, refreshAllStocks } from '@/lib/refresh'

const BASE_METRICS = {
  peRatio: null,
  week52High: null,
  week52Low: null,
  pegRatio: null,
  roe: null,
  netMargin: null,
  debtToEquity: null,
  dividendYield: null,
  payoutRatio: null,
  relativePerf13W: null,
  epsTTM: null,
  epsGrowth5Y: null,
}

describe('refreshStock', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('writes a price snapshot, news items, and recommendation rows for a known stock', async () => {
    const stock = await prisma.stock.create({
      data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
    })

    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 150, changePercent: 1.1, high: 151, low: 149, open: 149.5, previousClose: 148.9,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 3000000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({
      ...BASE_METRICS,
      peRatio: 28.5,
      week52High: 180,
      week52Low: 120,
      pegRatio: 1.4,
      roe: 22.5,
      debtToEquity: 0.8,
      epsTTM: 6.4,
      epsGrowth5Y: 12.5,
    })
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([
      { headline: 'Apple news', url: 'https://example.com/n1', source: 'Reuters', summary: 's', datetime: 1700000000 },
    ])
    vi.spyOn(finnhub, 'getRecommendationTrend').mockResolvedValue([
      { period: '2026-11-01', strongBuy: 11, buy: 19, hold: 15, sell: 3, strongSell: 1 },
    ])

    const result = await refreshStock('AAPL')
    expect(result).toEqual({ symbol: 'AAPL', ok: true })

    const snapshots = await prisma.priceSnapshot.findMany({ where: { stockId: stock.id } })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].pegRatio).toBe(1.4)
    expect(snapshots[0].roe).toBe(22.5)
    expect(snapshots[0].epsGrowth5Y).toBe(12.5)

    const news = await prisma.newsItem.findMany({ where: { stockId: stock.id } })
    expect(news).toHaveLength(1)

    const recs = await prisma.analystRecommendation.findMany({ where: { stockId: stock.id } })
    expect(recs).toHaveLength(1)
    expect(recs[0].strongBuy).toBe(11)
    expect(recs[0].period).toEqual(new Date('2026-11-01'))
  })

  it('returns ok:false and does not throw when Finnhub fails', async () => {
    await prisma.stock.create({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockRejectedValue(new Error('Finnhub request failed: 429 /quote'))

    const result = await refreshStock('MSFT')
    expect(result).toEqual({ symbol: 'MSFT', ok: false, error: 'Finnhub request failed: 429 /quote' })
  })

  it('logs the failure so it is visible in server logs, per the spec', async () => {
    await prisma.stock.create({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockRejectedValue(new Error('Finnhub request failed: 429 /quote'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await refreshStock('MSFT')

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('MSFT'), expect.anything())
  })

  it('does not duplicate news items with the same url on repeated refresh', async () => {
    await prisma.stock.create({ data: { symbol: 'TSLA', name: 'Tesla', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 200, changePercent: 0.5, high: 201, low: 199, open: 199, previousClose: 199,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Tesla', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 600000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(BASE_METRICS)
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([
      { headline: 'Tesla news', url: 'https://example.com/t1', source: 'Reuters', summary: 's', datetime: 1700000000 },
    ])
    vi.spyOn(finnhub, 'getRecommendationTrend').mockResolvedValue([])

    await refreshStock('TSLA')
    await refreshStock('TSLA')

    const news = await prisma.newsItem.findMany({ where: { headline: 'Tesla news' } })
    expect(news).toHaveLength(1)
  })

  it('updates rather than duplicates a recommendation row for the same period on repeated refresh', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'TSLA', name: 'Tesla', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 200, changePercent: 0.5, high: 201, low: 199, open: 199, previousClose: 199,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Tesla', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 600000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(BASE_METRICS)
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([])
    vi.spyOn(finnhub, 'getRecommendationTrend')
      .mockResolvedValueOnce([{ period: '2026-11-01', strongBuy: 5, buy: 5, hold: 5, sell: 5, strongSell: 5 }])
      .mockResolvedValueOnce([{ period: '2026-11-01', strongBuy: 20, buy: 5, hold: 2, sell: 0, strongSell: 0 }])

    await refreshStock('TSLA')
    await refreshStock('TSLA')

    const recs = await prisma.analystRecommendation.findMany({ where: { stockId: stock.id } })
    expect(recs).toHaveLength(1)
    expect(recs[0].strongBuy).toBe(20)
  })

  it('still writes the price snapshot when the recommendation-trend fetch fails', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 150, changePercent: 1.1, high: 151, low: 149, open: 149.5, previousClose: 148.9,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 3000000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(BASE_METRICS)
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([])
    vi.spyOn(finnhub, 'getRecommendationTrend').mockRejectedValue(new Error('Finnhub request failed: 500 /stock/recommendation'))

    const result = await refreshStock('AAPL')
    expect(result).toEqual({ symbol: 'AAPL', ok: true })

    const snapshots = await prisma.priceSnapshot.findMany({ where: { stockId: stock.id } })
    expect(snapshots).toHaveLength(1)
    const recs = await prisma.analystRecommendation.findMany({ where: { stockId: stock.id } })
    expect(recs).toHaveLength(0)
  })
})

describe('refreshAllStocks', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('isolates one failing symbol from the rest', async () => {
    await prisma.stock.create({ data: { symbol: 'GOOD', name: 'Good Co', exchange: 'NASDAQ' } })
    await prisma.stock.create({ data: { symbol: 'BAD', name: 'Bad Co', exchange: 'NASDAQ' } })

    vi.spyOn(finnhub, 'getQuote').mockImplementation(async (symbol: string) => {
      if (symbol === 'BAD') throw new Error('Finnhub request failed: 429 /quote')
      return { currentPrice: 10, changePercent: 0, high: 10, low: 10, open: 10, previousClose: 10 }
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Good Co', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 1,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(BASE_METRICS)
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([])
    vi.spyOn(finnhub, 'getRecommendationTrend').mockResolvedValue([])

    const results = await refreshAllStocks()
    expect(results).toHaveLength(2)
    expect(results.find((r) => r.symbol === 'GOOD')?.ok).toBe(true)
    expect(results.find((r) => r.symbol === 'BAD')?.ok).toBe(false)
  })
})
