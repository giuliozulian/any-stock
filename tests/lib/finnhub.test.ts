import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchSymbol, getQuote, getProfile, getMetrics, getCompanyNews } from '@/lib/finnhub'

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
    expect(metrics).toEqual({ peRatio: null, week52High: null, week52Low: null })
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
})
