import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import * as history from '@/lib/history'
import { recordVerdicts, evaluateMatureVerdicts, BENCHMARK } from '@/lib/verdict-log'
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

describe('evaluateMatureVerdicts', () => {
  // Stock +1 per day from 100 (+10% after 10 days); benchmark +4 per day from 4000 (+1% after 10 days).
  const STOCK_BARS = weekdayBars('2026-11-02', Array.from({ length: 40 }, (_, i) => 100 + i))
  const BENCH_BARS = weekdayBars('2026-11-02', Array.from({ length: 40 }, (_, i) => 4000 + i * 4))

  async function logVerdict(stockId: string, refDate = '2026-11-02', day = '2026-11-02') {
    return prisma.verdictLog.create({
      data: {
        stockId, day, refDate, refPrice: 100, overall: 'positive', score: 3,
        shortTerm: 'positive', shortTermLabel: 'Positivo', mediumTerm: 'unknown', mediumTermLabel: 'Nessun dato disponibile',
        longTerm: 'positive', longTermLabel: 'Fondamentali solidi', fairValue: 'unknown', fairValueNote: '', news: 'unknown', newsNote: '',
        rulesVersion: RULES_VERSION,
      },
    })
  }

  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
    vi.spyOn(history, 'getDailyBars').mockImplementation(async (symbol: string) => (symbol === BENCHMARK ? BENCH_BARS : STOCK_BARS))
  })

  it('writes the 10-day outcome once its horizon has matured and leaves the longer ones pending', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    const log = await logVerdict(apple.id)

    expect(await evaluateMatureVerdicts(new Date('2026-11-20T08:30:00Z'))).toEqual({ evaluated: 1, failed: 0 })

    const outcomes = await prisma.verdictOutcome.findMany({ where: { verdictId: log.id } })
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].horizon).toBe(10)
    expect(outcomes[0].evalDate).toBe('2026-11-16')
    expect(outcomes[0].stockReturnPct).toBeCloseTo(10, 6)
    expect(outcomes[0].excessPct).toBeCloseTo(9, 6)
  })

  it('does not duplicate an outcome when run again', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await logVerdict(apple.id)
    await evaluateMatureVerdicts(new Date('2026-11-20T08:30:00Z'))

    expect(await evaluateMatureVerdicts(new Date('2026-11-21T08:30:00Z'))).toEqual({ evaluated: 0, failed: 0 })
    expect(await prisma.verdictOutcome.count()).toBe(1)
  })

  it('does not download any bars while no horizon can have matured', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await logVerdict(apple.id, '2026-11-16', '2026-11-16')
    const spy = vi.spyOn(history, 'getDailyBars')

    expect(await evaluateMatureVerdicts(new Date('2026-11-20T08:30:00Z'))).toEqual({ evaluated: 0, failed: 0 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('writes nothing and counts a failure when the benchmark bars are missing', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await logVerdict(apple.id)
    vi.spyOn(history, 'getDailyBars').mockImplementation(async (symbol: string) => (symbol === BENCHMARK ? [] : STOCK_BARS))

    expect(await evaluateMatureVerdicts(new Date('2026-11-20T08:30:00Z'))).toEqual({ evaluated: 0, failed: 1 })
    expect(await prisma.verdictOutcome.count()).toBe(0)
  })

  it('writes nothing for a stock whose bars are missing and still evaluates the others', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    const msft = await watch({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    await logVerdict(apple.id)
    await logVerdict(msft.id)
    vi.spyOn(history, 'getDailyBars').mockImplementation(async (symbol: string) => (symbol === BENCHMARK ? BENCH_BARS : symbol === 'AAPL' ? [] : STOCK_BARS))

    expect(await evaluateMatureVerdicts(new Date('2026-11-20T08:30:00Z'))).toEqual({ evaluated: 1, failed: 1 })
  })
})
