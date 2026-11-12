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

  it('refuses to run against a DATABASE_URL that does not look like a test database', async () => {
    const original = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://user:pass@prod-host/any_stock_production'

    await expect(resetDb()).rejects.toThrow(/does not look like a test database/)

    process.env.DATABASE_URL = original
  })

  it('cascades AnalystRecommendation deletes when a stock is removed', async () => {
    const stock = await prisma.stock.create({
      data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' },
    })

    await prisma.analystRecommendation.create({
      data: {
        stockId: stock.id,
        period: new Date('2026-11-01'),
        strongBuy: 10,
        buy: 20,
        hold: 5,
        sell: 1,
        strongSell: 0,
      },
    })

    await prisma.stock.delete({ where: { symbol: 'MSFT' } })

    const orphans = await prisma.analystRecommendation.findMany({ where: { stockId: stock.id } })
    expect(orphans).toHaveLength(0)
  })
})
