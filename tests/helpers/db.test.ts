import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from './db'

describe('database setup', () => {
  beforeEach(resetDb)

  it('creates and reads back a stock with cascading snapshot delete', async () => {
    const stock = await prisma.stock.create({
      data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
    })

    await prisma.priceSnapshot.create({
      data: { stockId: stock.id, price: 150.0, changePct: 1.2 },
    })

    const found = await prisma.stock.findUnique({
      where: { symbol: 'AAPL' },
      include: { snapshots: true },
    })
    expect(found?.snapshots).toHaveLength(1)

    await prisma.stock.delete({ where: { symbol: 'AAPL' } })

    const orphanSnapshots = await prisma.priceSnapshot.findMany({ where: { stockId: stock.id } })
    expect(orphanSnapshots).toHaveLength(0)
  })
})
