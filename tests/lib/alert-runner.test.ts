import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import * as notify from '@/lib/notify'
import { resetDb, watch } from '../helpers/db'
import { checkAllAlerts, notifyTargets } from '@/lib/alert-runner'

describe('price alerts with an unusable price', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  const armedStock = () => watch({ data: { symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ', entryPrice: 100, sellPrice: 200 } })

  it.each([0, -1, NaN])('notifyTargets sends nothing and arms nothing for price %s', async (price) => {
    const send = vi.spyOn(notify, 'sendAlertEmail').mockResolvedValue(true)
    const stock = await armedStock()

    await notifyTargets(stock, price)

    expect(send).not.toHaveBeenCalled()
    const stored = await prisma.watchlistEntry.findUniqueOrThrow({ where: { id: stock.entry.id } })
    expect(stored.entryTriggeredAt).toBeNull()
    expect(stored.sellTriggeredAt).toBeNull()
  })

  it('still fires a real entry alert for a normal price', async () => {
    const send = vi.spyOn(notify, 'sendAlertEmail').mockResolvedValue(true)
    const stock = await armedStock()

    await notifyTargets(stock, 95)

    expect(send).toHaveBeenCalledTimes(1)
    expect((await prisma.watchlistEntry.findUniqueOrThrow({ where: { id: stock.entry.id } })).entryTriggeredAt).not.toBeNull()
  })

  it('checkAllAlerts does not send a false entry alert when Finnhub answers 0 for the symbol', async () => {
    const send = vi.spyOn(notify, 'sendAlertEmail').mockResolvedValue(true)
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({ currentPrice: 0, changePercent: 0, high: 0, low: 0, open: 0, previousClose: 0 })
    const stock = await armedStock()

    const result = await checkAllAlerts()

    expect(send).not.toHaveBeenCalled()
    expect(result.checked).toBe(1)
    expect((await prisma.watchlistEntry.findUniqueOrThrow({ where: { id: stock.entry.id } })).entryTriggeredAt).toBeNull()
  })
})

describe('price alerts with several watchers', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('checks each watcher\'s own target and mails each at their own address', async () => {
    const send = vi.spyOn(notify, 'sendAlertEmail').mockResolvedValue(true)
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({ currentPrice: 90, changePercent: 0, high: 91, low: 89, open: 90, previousClose: 90 })
    const mine = await watch({ data: { symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ', entryPrice: 100 } })
    await prisma.watchlistEntry.create({ data: { userId: 'friend', userEmail: 'friend@x.it', stockId: mine.id, entryPrice: 80 } })

    const result = await checkAllAlerts()

    expect(result).toEqual({ checked: 1, failed: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][1]).toBe('dev@local')
    expect((await prisma.watchlistEntry.findUniqueOrThrow({ where: { id: mine.entry.id } })).entryTriggeredAt).not.toBeNull()
    expect(await prisma.watchlistEntry.count({ where: { userId: 'friend', entryTriggeredAt: null } })).toBe(1)
  })
})
