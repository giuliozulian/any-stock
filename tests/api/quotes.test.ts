import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as finnhub from '@/lib/finnhub'
import * as yahooLib from '@/lib/yahoo-quote'
import { resetDb, watch } from '../helpers/db'
import { GET as getQuotes } from '@/app/api/quotes/route'

const request = (symbols: string) => new Request(`http://localhost/api/quotes?symbols=${symbols}`) as any

describe('live quotes API', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('takes the price from Yahoo when Finnhub has no access to the symbol', async () => {
    await watch({ data: { symbol: 'WCBR.MI', name: 'WisdomTree Cybersecurity', exchange: 'Milan' } })
    vi.spyOn(finnhub, 'getQuote').mockRejectedValue(new Error('Finnhub request failed: 403 /quote'))
    vi.spyOn(yahooLib, 'getYahooQuote').mockResolvedValue({ name: 'x', exchange: 'Milan', currency: 'EUR', price: 30, changePct: 1.5 })

    const body = await (await getQuotes(request('WCBR.MI'))).json()
    expect(body.quotes['WCBR.MI']).toEqual({ price: 30, changePct: 1.5 })
  })

  it('leaves the symbol out when neither source answers', async () => {
    await watch({ data: { symbol: 'WCBR.MI', name: 'WisdomTree Cybersecurity', exchange: 'Milan' } })
    vi.spyOn(finnhub, 'getQuote').mockRejectedValue(new Error('Finnhub request failed: 403 /quote'))
    vi.spyOn(yahooLib, 'getYahooQuote').mockResolvedValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const body = await (await getQuotes(request('WCBR.MI'))).json()
    expect(body.quotes).toEqual({})
  })
})
