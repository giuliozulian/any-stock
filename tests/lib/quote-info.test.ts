import { afterEach, describe, expect, it, vi } from 'vitest'
import { getQuoteInfo } from '@/lib/quote-info'

describe('getQuoteInfo', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads name, market cap and session time, and caches per symbol', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('fc.yahoo.com')) return Promise.resolve({ headers: { getSetCookie: () => ['A=1'] } })
      if (url.includes('getcrumb')) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('crumb') })
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ quoteResponse: { result: [{ symbol: 'ZZQ1', shortName: 'Zed', marketCap: 5e9, regularMarketPrice: 12.5, regularMarketChangePercent: 2, regularMarketTime: 1_700_000_000 }] } }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const first = await getQuoteInfo(['ZZQ1', 'ZZQ1'])
    expect(first.get('ZZQ1')).toEqual({ name: 'Zed', marketCap: 5e9, price: 12.5, changePct: 2, time: 1_700_000_000_000 })
    const calls = fetchMock.mock.calls.length
    await getQuoteInfo(['ZZQ1'])
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('returns what it has when a request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    expect((await getQuoteInfo(['ZZQ2'])).size).toBe(0)
  })
})
