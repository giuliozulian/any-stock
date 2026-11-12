import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchSymbol, getQuote, getProfile, getMetrics, getCompanyNews, getRecommendationTrend, getNextEarnings, getIpoCalendar } from '@/lib/finnhub'

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: () => Promise.resolve(body),
    })
  )
}

describe('finnhub client', () => {
  beforeEach(() => {
    process.env.FINNHUB_API_KEY = 'test-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('searchSymbol returns matches', async () => {
    mockFetchOnce({ result: [{ symbol: 'AAPL', description: 'Apple Inc', type: 'Common Stock' }] })
    const results = await searchSymbol('AAPL')
    expect(results).toEqual([{ symbol: 'AAPL', description: 'Apple Inc', type: 'Common Stock' }])
  })

  it('getQuote maps Finnhub fields to named fields', async () => {
    mockFetchOnce({ c: 150.5, dp: 1.25, h: 152, l: 148, o: 149, pc: 148.7 })
    const quote = await getQuote('AAPL')
    expect(quote).toEqual({
      currentPrice: 150.5,
      changePercent: 1.25,
      high: 152,
      low: 148,
      open: 149,
      previousClose: 148.7,
    })
  })

  it('getProfile maps company profile fields', async () => {
    mockFetchOnce({ name: 'Apple Inc', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 3000000 })
    const profile = await getProfile('AAPL')
    expect(profile).toEqual({
      name: 'Apple Inc',
      exchange: 'NASDAQ',
      currency: 'USD',
      marketCapitalization: 3000000,
    })
  })

  it('getMetrics falls back to null for missing fields', async () => {
    mockFetchOnce({ metric: {} })
    const metrics = await getMetrics('AAPL')
    expect(metrics).toEqual({
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
    })
  })

  it('getMetrics maps fundamental and momentum fields when present', async () => {
    mockFetchOnce({
      metric: {
        pegTTM: 1.4,
        roeTTM: 22.5,
        netProfitMarginTTM: 18.2,
        'totalDebt/totalEquityAnnual': 0.8,
        currentDividendYieldTTM: 0.5,
        payoutRatioTTM: 15,
        'priceRelativeToS&P50013Week': 3.1,
        epsTTM: 6.4,
        epsGrowth5Y: 12.5,
      },
    })
    const metrics = await getMetrics('AAPL')
    expect(metrics).toMatchObject({
      pegRatio: 1.4,
      roe: 22.5,
      netMargin: 18.2,
      debtToEquity: 0.8,
      dividendYield: 0.5,
      payoutRatio: 15,
      relativePerf13W: 3.1,
      epsTTM: 6.4,
      epsGrowth5Y: 12.5,
    })
  })

  it('getRecommendationTrend maps analyst recommendation periods', async () => {
    mockFetchOnce([
      { symbol: 'AAPL', period: '2026-11-01', strongBuy: 11, buy: 19, hold: 15, sell: 3, strongSell: 1 },
      { symbol: 'AAPL', period: '2026-10-01', strongBuy: 11, buy: 20, hold: 14, sell: 3, strongSell: 1 },
    ])
    const trend = await getRecommendationTrend('AAPL')
    expect(trend).toEqual([
      { period: '2026-11-01', strongBuy: 11, buy: 19, hold: 15, sell: 3, strongSell: 1 },
      { period: '2026-10-01', strongBuy: 11, buy: 20, hold: 14, sell: 3, strongSell: 1 },
    ])
  })

  it('getCompanyNews maps news items', async () => {
    mockFetchOnce([
      { headline: 'Apple hits new high', url: 'https://example.com/a', source: 'Reuters', summary: 'summary', datetime: 1700000000 },
    ])
    const news = await getCompanyNews('AAPL', '2026-11-01', '2026-11-11')
    expect(news).toEqual([
      { headline: 'Apple hits new high', url: 'https://example.com/a', source: 'Reuters', summary: 'summary', datetime: 1700000000 },
    ])
  })

  it('throws a clear error when Finnhub returns a non-ok response', async () => {
    mockFetchOnce({}, false)
    await expect(getQuote('AAPL')).rejects.toThrow('Finnhub request failed: 500 /quote')
  })

  it('throws when FINNHUB_API_KEY is not set', async () => {
    delete process.env.FINNHUB_API_KEY
    mockFetchOnce({ c: 1, dp: 1, h: 1, l: 1, o: 1, pc: 1 })
    await expect(getQuote('AAPL')).rejects.toThrow('FINNHUB_API_KEY is not set')
  })
  it('getNextEarnings returns the earliest upcoming date and ignores past ones', async () => {
    mockFetchOnce({
      earningsCalendar: [
        { date: '2027-02-23', hour: 'amc', epsEstimate: 2.8 },
        { date: '2026-11-17', hour: 'amc', epsEstimate: 2.52 },
        { date: '2026-08-01', hour: '', epsEstimate: 1 },
      ],
    })
    const next = await getNextEarnings('NVDA', new Date('2026-11-12T10:00:00Z'))
    expect(next).toEqual({ date: '2026-11-17', hour: 'amc', epsEstimate: 2.52 })
  })

  it('getNextEarnings returns null when nothing is scheduled', async () => {
    mockFetchOnce({ earningsCalendar: [] })
    expect(await getNextEarnings('XYZ', new Date('2026-11-12T10:00:00Z'))).toBeNull()
  })
  it('getIpoCalendar maps and sorts by date then size', async () => {
    mockFetchOnce({
      ipoCalendar: [
        { date: '2026-11-19', name: 'Big', symbol: 'BIG', exchange: 'NASDAQ', price: '10-12', totalSharesValue: 500 },
        { date: '2026-11-13', name: 'Small', symbol: '', totalSharesValue: 5 },
        { date: '2026-11-13', name: 'Mid', symbol: 'MID', totalSharesValue: 50 },
      ],
    })
    const ipos = await getIpoCalendar('2026-11-12', '2026-12-30')
    expect(ipos.map((i) => i.name)).toEqual(['Mid', 'Small', 'Big'])
    expect(ipos[1].symbol).toBeNull()
  })
})
