import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import * as history from '@/lib/history'
import { recordVerdicts } from '@/lib/verdict-log'
import { RULES_VERSION } from '@/lib/evaluate'
import { resetDb, watch } from '../helpers/db'
import { weekdayBars } from '../helpers/bars'

const NOW = new Date('2026-11-20T08:30:00Z')
// 15 weekday bars from Monday 2026-10-26: the last one is Friday 2026-11-13 and closes at 114.
const BARS = weekdayBars('2026-10-26', Array.from({ length: 15 }, (_, i) => 100 + i))

const METRICS = {
  peRatio: null, week52High: 120, week52Low: 80, pegRatio: 0.8, roe: 20, netMargin: 10, debtToEquity: 0.5, dividendYield: 1,
  payoutRatio: 20, relativePerf13W: 5, epsTTM: 5, epsGrowth5Y: 10,
}

async function snapshot(stockId: string, price = 114) {
  await prisma.priceSnapshot.create({ data: { stockId, price, changePct: 1, week52High: 120, week52Low: 80, relativePerf13W: 5, pegRatio: 0.8, roe: 20, debtToEquity: 0.5 } })
}

describe('recordVerdicts', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
    vi.spyOn(history, 'getDailyBars').mockResolvedValue(BARS)
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({ ...METRICS })
  })

  it('records one verdict per watched stock with tones, labels, reference bar and rules version', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await snapshot(apple.id)

    expect(await recordVerdicts(NOW)).toEqual({ recorded: 1, skipped: 0, failed: 0 })

    const log = await prisma.verdictLog.findFirstOrThrow({ where: { stockId: apple.id } })
    expect(log.day).toBe('2026-11-20')
    expect(log.refDate).toBe('2026-11-13')
    expect(log.refPrice).toBe(114)
    expect(log.rulesVersion).toBe(RULES_VERSION)
    expect(log.shortTerm).toBe('positive')
    expect(log.shortTermLabel).toBe('Positivo')
    expect(log.longTerm).toBe('positive')
    expect(log.mediumTerm).toBe('unknown')
  })

  it('does not duplicate when run again the same day', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await snapshot(apple.id)
    await recordVerdicts(NOW)

    expect(await recordVerdicts(NOW)).toEqual({ recorded: 0, skipped: 0, failed: 0 })
    expect(await prisma.verdictLog.count()).toBe(1)
  })

  it('skips a stock without a snapshot or without bars', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    expect(await recordVerdicts(NOW)).toEqual({ recorded: 0, skipped: 1, failed: 0 })

    const msft = await watch({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    await snapshot(msft.id)
    vi.spyOn(history, 'getDailyBars').mockResolvedValue([])
    expect(await recordVerdicts(NOW)).toEqual({ recorded: 0, skipped: 2, failed: 0 })
    expect(await prisma.verdictLog.count()).toBe(0)
  })

  it('still records the verdict, with an unknown fair value, when the metrics call fails', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await snapshot(apple.id)
    vi.spyOn(finnhub, 'getMetrics').mockRejectedValue(new Error('Finnhub request failed: 429 /stock/metric'))

    expect(await recordVerdicts(NOW)).toMatchObject({ recorded: 1, failed: 0 })
    expect((await prisma.verdictLog.findFirstOrThrow()).fairValue).toBe('unknown')
  })

  it('ignores stocks nobody watches', async () => {
    const orphan = await prisma.stock.create({ data: { symbol: 'ZZZ', name: 'Nobody', exchange: 'NASDAQ' } })
    await snapshot(orphan.id)
    expect(await recordVerdicts(NOW)).toEqual({ recorded: 0, skipped: 0, failed: 0 })
  })

  it('counts a stock whose processing throws as failed and goes on with the others', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    const msft = await watch({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    await snapshot(apple.id)
    await snapshot(msft.id)
    vi.spyOn(history, 'getDailyBars').mockImplementation(async (symbol: string) => {
      if (symbol === 'AAPL') throw new Error('boom')
      return BARS
    })

    expect(await recordVerdicts(NOW)).toEqual({ recorded: 1, skipped: 0, failed: 1 })
  })
})
