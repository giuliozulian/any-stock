import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import * as refreshLib from '@/lib/refresh'
import { resetDb } from '../helpers/db'
import { GET as listStocks, POST as addStock } from '@/app/api/stocks/route'
import { GET as getStock, DELETE as deleteStock } from '@/app/api/stocks/[symbol]/route'

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/stocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

describe('stocks API', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('POST adds a new stock after validating it with Finnhub', async () => {
    vi.spyOn(finnhub, 'searchSymbol').mockResolvedValue([{ symbol: 'AAPL', description: 'Apple Inc', type: 'Common Stock' }])
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({ name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 3000000 })
    vi.spyOn(refreshLib, 'refreshStock').mockResolvedValue({ symbol: 'AAPL', ok: true })

    const res = await addStock(jsonRequest({ symbol: 'aapl' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.stock.symbol).toBe('AAPL')

    const stored = await prisma.stock.findUnique({ where: { symbol: 'AAPL' } })
    expect(stored).not.toBeNull()
  })

  it('POST returns 404 for an unknown symbol instead of creating a row', async () => {
    vi.spyOn(finnhub, 'searchSymbol').mockResolvedValue([])

    const res = await addStock(jsonRequest({ symbol: 'ZZZZZ' }))
    expect(res.status).toBe(404)

    const stored = await prisma.stock.findUnique({ where: { symbol: 'ZZZZZ' } })
    expect(stored).toBeNull()
  })

  it('POST returns 409 when the symbol is already in the watchlist', async () => {
    await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })

    const res = await addStock(jsonRequest({ symbol: 'AAPL' }))
    expect(res.status).toBe(409)
  })

  it('GET /api/stocks lists stocks with their latest snapshot', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 150, changePct: 1 } })

    const res = await listStocks()
    const body = await res.json()
    expect(body.stocks).toHaveLength(1)
    expect(body.stocks[0].snapshots).toHaveLength(1)
  })

  it('DELETE removes a stock and cascades its snapshots', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 150, changePct: 1 } })

    const res = await deleteStock(new Request('http://localhost/api/stocks/AAPL') as any, { params: Promise.resolve({ symbol: 'AAPL' }) })
    expect(res.status).toBe(200)

    const stored = await prisma.stock.findUnique({ where: { symbol: 'AAPL' } })
    expect(stored).toBeNull()
    const snapshots = await prisma.priceSnapshot.findMany({ where: { stockId: stock.id } })
    expect(snapshots).toHaveLength(0)
  })

  it('DELETE returns 404 for a symbol not in the watchlist', async () => {
    const res = await deleteStock(new Request('http://localhost/api/stocks/NOPE') as any, { params: Promise.resolve({ symbol: 'NOPE' }) })
    expect(res.status).toBe(404)
  })

  it('GET detail returns 404 for a symbol not in the watchlist', async () => {
    const res = await getStock(new Request('http://localhost/api/stocks/NOPE') as any, { params: Promise.resolve({ symbol: 'NOPE' }) })
    expect(res.status).toBe(404)
  })
})
