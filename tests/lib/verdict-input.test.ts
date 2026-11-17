import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { fairValue } from '@/lib/fair-value'
import { loadVerdictInput } from '@/lib/verdict-note'
import { resetDb } from '../helpers/db'

describe('loadVerdictInput', () => {
  beforeEach(async () => {
    await resetDb()
  })

  async function stockWithSnapshot() {
    const stock = await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 100, changePct: 1, epsTTM: 5, epsGrowth5Y: 10 } })
    return stock
  }

  it('evaluates the fair value the caller computed from the live metrics, which the snapshot cannot hold', async () => {
    const stock = await stockWithSnapshot()
    const fv = fairValue({ price: 100, epsTTM: 5, bookValuePerShare: 40, epsGrowth5Y: 10, dividendYield: 1, priceToFcf: 100 / 6 })

    const input = await loadVerdictInput(stock.id, fv)

    expect(input?.evaluation.fairValue.position).toBe('unclear')
    expect(input?.evaluation.fairValue.low).toBeCloseTo(55, 5)
  })

  it('says the fair value is not available when the caller has none', async () => {
    const stock = await stockWithSnapshot()
    const input = await loadVerdictInput(stock.id)
    expect(input?.evaluation.fairValue.position).toBeNull()
    expect(input?.evaluation.fairValue.note).toMatch(/non disponibile/i)
  })
})
