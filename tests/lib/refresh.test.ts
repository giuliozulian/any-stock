import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import { resetDb } from '../helpers/db'
import { refreshStock, refreshAllStocks } from '@/lib/refresh'

describe('refreshStock', () => {
  beforeEach(resetDb)

  it('writes a price snapshot and news items for a known stock', async () => {
    const stock = await prisma.stock.create({
      data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
    })

    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 150, changePercent: 1.1, high: 151, low: 149, open: 149.5, previousClose: 148.9,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 3000000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({ peRatio: 28.5, week52High: 180, week52Low: 120 })
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([
      { headline: 'Apple news', url: 'https://example.com/n1', source: 'Reuters', summary: 's', datetime: 1700000000 },
    ])

    const result = await refreshStock('AAPL')
    expect(result).toEqual({ symbol: 'AAPL', ok: true })

    const snapshots = await prisma.priceSnapshot.findMany({ where: { stockId: stock.id } })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].price).toBe(150)

    const news = await prisma.newsItem.findMany({ where: { stockId: stock.id } })
    expect(news).toHaveLength(1)
    expect(news[0].headline).toBe('Apple news')
  })

  it('returns ok:false and does not throw when Finnhub fails', async () => {
    await prisma.stock.create({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockRejectedValue(new Error('Finnhub request failed: 429 /quote'))

    const result = await refreshStock('MSFT')
    expect(result).toEqual({ symbol: 'MSFT', ok: false, error: 'Finnhub request failed: 429 /quote' })
  })

  it('does not duplicate news items with the same url on repeated refresh', async () => {
    await prisma.stock.create({ data: { symbol: 'TSLA', name: 'Tesla', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 200, changePercent: 0.5, high: 201, low: 199, open: 199, previousClose: 199,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Tesla', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 600000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({ peRatio: null, week52High: null, week52Low: null })
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([
      { headline: 'Tesla news', url: 'https://example.com/t1', source: 'Reuters', summary: 's', datetime: 1700000000 },
    ])

    await refreshStock('TSLA')
    await refreshStock('TSLA')

    const news = await prisma.newsItem.findMany({ where: { headline: 'Tesla news' } })
    expect(news).toHaveLength(1)
  })
})

describe('refreshAllStocks', () => {
  beforeEach(resetDb)

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
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({ peRatio: null, week52High: null, week52Low: null })
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([])

    const results = await refreshAllStocks()
    expect(results).toHaveLength(2)
    expect(results.find((r) => r.symbol === 'GOOD')?.ok).toBe(true)
    expect(results.find((r) => r.symbol === 'BAD')?.ok).toBe(false)
  })
})
