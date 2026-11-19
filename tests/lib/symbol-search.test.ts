import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as finnhub from '@/lib/finnhub'
import * as yahoo from '@/lib/yahoo-quote'
import { searchSymbols } from '@/lib/symbol-search'

describe('searchSymbols', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('finds the Borsa Italiana line of an ETF searched by ISIN', async () => {
    vi.spyOn(finnhub, 'searchSymbol').mockResolvedValue([{ symbol: 'WCBR.L', description: 'WisdomTree Cybersecurity UCITS ETF USD Acc', type: 'ETP' }])
    vi.spyOn(yahoo, 'searchYahoo').mockImplementation(async (q) =>
      q === 'WCBR'
        ? [
            { symbol: 'WCBR', description: 'WisdomTree Cybersecurity Fund', type: 'ETF' },
            { symbol: 'WCBR.L', description: 'WT CYBER', type: 'ETF' },
            { symbol: 'WCBR.MI', description: 'WISDOMTREE CYBERSECURITY UCITS', type: 'ETF' },
          ]
        : [],
    )

    const results = await searchSymbols('IE00BLPK3577')
    expect(results.map((r) => r.symbol)).toEqual(['WCBR.L', 'WCBR.MI'])
  })

  it('merges Finnhub and Yahoo without duplicates, Finnhub first', async () => {
    vi.spyOn(finnhub, 'searchSymbol').mockResolvedValue([{ symbol: 'AAPL', description: 'Apple Inc', type: 'Common Stock' }])
    vi.spyOn(yahoo, 'searchYahoo').mockResolvedValue([
      { symbol: 'AAPL', description: 'Apple Inc.', type: 'EQUITY' },
      { symbol: 'AAPL.MI', description: 'Apple Milan', type: 'EQUITY' },
    ])

    const results = await searchSymbols('apple')
    expect(results.map((r) => r.symbol)).toEqual(['AAPL', 'AAPL.MI'])
    expect(results[0].description).toBe('Apple Inc')
  })

  it('still answers when only one source works', async () => {
    vi.spyOn(finnhub, 'searchSymbol').mockRejectedValue(new Error('Finnhub request failed: 429 /search'))
    vi.spyOn(yahoo, 'searchYahoo').mockResolvedValue([{ symbol: 'WCBR.MI', description: 'x', type: 'ETF' }])

    expect((await searchSymbols('WCBR')).map((r) => r.symbol)).toEqual(['WCBR.MI'])
  })

  it('throws when both sources fail', async () => {
    vi.spyOn(finnhub, 'searchSymbol').mockRejectedValue(new Error('Finnhub request failed: 500 /search'))
    vi.spyOn(yahoo, 'searchYahoo').mockRejectedValue(new Error('Yahoo search failed: 500'))

    await expect(searchSymbols('AAPL')).rejects.toThrow('Finnhub request failed')
  })
})
