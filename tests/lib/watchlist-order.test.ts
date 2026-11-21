import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { WATCHLIST_ORDER, reorderWatchlist } from '@/lib/watchlist'
import { resetDb, watch } from '../helpers/db'

const stock = (symbol: string, addedAt: Date, userId = 'dev') => watch({ data: { symbol, name: symbol, exchange: 'NASDAQ', addedAt } }, userId)
const symbols = async (userId = 'dev') => (await prisma.watchlistEntry.findMany({ where: { userId }, orderBy: WATCHLIST_ORDER, include: { stock: true } })).map((e) => e.stock.symbol)

describe('watchlist order', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('keeps the order of addition for someone who never reordered', async () => {
    await stock('BBB', new Date('2026-01-02'))
    await stock('AAA', new Date('2026-01-01'))
    await stock('CCC', new Date('2026-01-03'))
    expect(await symbols()).toEqual(['AAA', 'BBB', 'CCC'])
  })

  it('puts a stock added after a reorder at the end', async () => {
    await stock('AAA', new Date('2026-01-01'))
    await stock('BBB', new Date('2026-01-02'))
    expect(await reorderWatchlist('dev', ['BBB', 'AAA'])).toBe('ok')
    await stock('CCC', new Date('2026-01-03'))
    expect(await symbols()).toEqual(['BBB', 'AAA', 'CCC'])
  })
})

describe('reorderWatchlist', () => {
  beforeEach(async () => {
    await resetDb()
    await stock('AAA', new Date('2026-01-01'))
    await stock('BBB', new Date('2026-01-02'))
    await stock('CCC', new Date('2026-01-03'))
  })

  it('stores the new order', async () => {
    expect(await reorderWatchlist('dev', ['CCC', 'AAA', 'BBB'])).toBe('ok')
    expect(await symbols()).toEqual(['CCC', 'AAA', 'BBB'])
  })

  it('refuses a list that misses, repeats or invents a stock, and changes nothing', async () => {
    for (const bad of [['AAA', 'BBB'], ['AAA', 'BBB', 'CCC', 'DDD'], ['AAA', 'AAA', 'BBB'], ['AAA', 'BBB', 'ZZZ'], []]) {
      expect(await reorderWatchlist('dev', bad)).toBe('mismatch')
    }
    expect(await symbols()).toEqual(['AAA', 'BBB', 'CCC'])
  })

  it("never touches somebody else's list", async () => {
    const aaa = await prisma.stock.findUniqueOrThrow({ where: { symbol: 'AAA' } })
    await prisma.watchlistEntry.create({ data: { userId: 'other', stockId: aaa.id } })
    expect(await reorderWatchlist('dev', ['CCC', 'BBB', 'AAA'])).toBe('ok')
    const other = await prisma.watchlistEntry.findMany({ where: { userId: 'other' } })
    expect(other.every((e) => e.position === null)).toBe(true)
  })
})
