import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as refreshLib from '@/lib/refresh'
import { resetDb } from '../helpers/db'
import { POST as manualRefresh } from '@/app/api/stocks/[symbol]/refresh/route'
import { GET as cronRefresh } from '@/app/api/cron/refresh/route'

describe('manual refresh route', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('returns 404 for a symbol not in the watchlist', async () => {
    const res = await manualRefresh(new Request('http://localhost') as any, { params: Promise.resolve({ symbol: 'NOPE' }) })
    expect(res.status).toBe(404)
  })

  it('returns 502 when refresh fails', async () => {
    await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    vi.spyOn(refreshLib, 'refreshStock').mockResolvedValue({ symbol: 'AAPL', ok: false, error: 'Finnhub request failed: 429 /quote' })

    const res = await manualRefresh(new Request('http://localhost') as any, { params: Promise.resolve({ symbol: 'AAPL' }) })
    expect(res.status).toBe(502)
  })

  it('returns 200 when refresh succeeds', async () => {
    await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    vi.spyOn(refreshLib, 'refreshStock').mockResolvedValue({ symbol: 'AAPL', ok: true })

    const res = await manualRefresh(new Request('http://localhost') as any, { params: Promise.resolve({ symbol: 'AAPL' }) })
    expect(res.status).toBe(200)
  })
})

describe('cron refresh route', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('rejects requests without the correct bearer token', async () => {
    const res = await cronRefresh(new Request('http://localhost', { headers: { authorization: 'Bearer wrong' } }) as any)
    expect(res.status).toBe(401)
  })

  it('rejects every request when CRON_SECRET is not set, even "Bearer undefined"', async () => {
    delete process.env.CRON_SECRET

    const res = await cronRefresh(new Request('http://localhost', { headers: { authorization: 'Bearer undefined' } }) as any)
    expect(res.status).toBe(401)
  })

  it('refreshes all stocks and reports per-symbol results when authorized', async () => {
    vi.spyOn(refreshLib, 'refreshAllStocks').mockResolvedValue([
      { symbol: 'GOOD', ok: true },
      { symbol: 'BAD', ok: false, error: 'Finnhub request failed: 429 /quote' },
    ])

    const res = await cronRefresh(new Request('http://localhost', { headers: { authorization: 'Bearer test-secret' } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refreshed).toBe(2)
    expect(body.failed).toBe(1)
  })
})
