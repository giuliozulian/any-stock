import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { PUT as reorder } from '@/app/api/stocks/order/route'
import { resetDb, watch } from '../helpers/db'

const put = (body: unknown) =>
  reorder(new Request('http://localhost/api/stocks/order', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }) as never)

describe('PUT /api/stocks/order', () => {
  beforeEach(async () => {
    await resetDb()
    await watch({ data: { symbol: 'AAA', name: 'A', exchange: 'NASDAQ', addedAt: new Date('2026-01-01') } })
    await watch({ data: { symbol: 'BBB', name: 'B', exchange: 'NASDAQ', addedAt: new Date('2026-01-02') } })
  })

  it('stores the order and says ok', async () => {
    const res = await put({ symbols: ['bbb', 'aaa'] })
    expect(res.status).toBe(200)
    const rows = await prisma.watchlistEntry.findMany({ include: { stock: true }, orderBy: { position: 'asc' } })
    expect(rows.map((r) => r.stock.symbol)).toEqual(['BBB', 'AAA'])
  })

  it('answers 400 when the list does not match the watchlist', async () => {
    expect((await put({ symbols: ['AAA'] })).status).toBe(400)
    expect((await put({ symbols: ['AAA', 'BBB', 'CCC'] })).status).toBe(400)
  })

  it.each([['not json'], [{}], [{ symbols: 'AAA' }], [{ symbols: [1, 2] }], [{ symbols: Array.from({ length: 501 }, (_, i) => `S${i}`) }]])('answers 400 on a malformed body %#', async (body) => {
    expect((await put(body)).status).toBe(400)
  })
})
