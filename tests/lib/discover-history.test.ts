import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as quoteInfo from '@/lib/quote-info'
import * as history from '@/lib/history'
import { resetDb } from '../helpers/db'
import { buildPick, summarizePicks, getPastPicks } from '@/lib/discover-history'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-17T12:00:00Z')
const entry = (over = {}) => ({ symbol: 'AAA', name: 'Aaa', scannedAt: new Date(NOW - 10 * DAY), score: 70, price: 100, ...over })

describe('buildPick', () => {
  it('measures the return and the excess over the market', () => {
    const p = buildPick(entry(), 112, 4, NOW)
    expect(p).toMatchObject({ returnPct: 12, marketPct: 4, excessPct: 8, days: 10 })
  })
  it('has no excess without a benchmark', () => {
    expect(buildPick(entry(), 90, null, NOW).excessPct).toBeNull()
  })
})

describe('summarizePicks', () => {
  it('counts how many beat the market, overall and for the high scores', () => {
    const picks = [buildPick(entry({ score: 80 }), 112, 4, NOW), buildPick(entry({ score: 70 }), 101, 4, NOW), buildPick(entry({ score: 40 }), 120, 4, NOW), buildPick(entry({ score: 30 }), 90, null, NOW)]
    const s = summarizePicks(picks)
    expect(s.count).toBe(4)
    expect(s.beat).toBe(2)
    expect(s.hitRate).toBeCloseTo(2 / 3)
    expect(s.avgExcessPct).toBeCloseTo((8 - 3 + 16) / 3)
    expect(s.high).toEqual({ count: 2, hitRate: 0.5 })
  })
  it('has no rates without data', () => {
    expect(summarizePicks([])).toEqual({ count: 0, beat: 0, hitRate: null, avgExcessPct: null, high: { count: 0, hitRate: null } })
  })
})

describe('getPastPicks', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('uses the first appearance of each stock, skips the young ones and the unpriced', async () => {
    const at = (days: number) => new Date(NOW - days * DAY)
    await prisma.discoveryHistory.createMany({
      data: [
        { symbol: 'OLD', scannedAt: at(30), score: 70, price: 100 },
        { symbol: 'OLD', scannedAt: at(5), score: 90, price: 130 },
        { symbol: 'NEW', scannedAt: at(3), score: 70, price: 50 },
        { symbol: 'NOPRICE', scannedAt: at(20), score: 70, price: null },
        { symbol: 'GONE', scannedAt: at(20), score: 70, price: 10 },
      ],
    })
    await prisma.discoveredCandidate.create({ data: { symbol: 'OLD', name: 'Old Inc', market: 'US', score: 90, momentumScore: 1, fundamentalsScore: 1, insiderScore: 1, reason: 'x', source: 'peer' } })
    vi.spyOn(quoteInfo, 'getQuoteInfo').mockResolvedValue(new Map([['OLD', { name: 'Old', marketCap: null, price: 120, changePct: null, time: null }]]))
    vi.spyOn(history, 'getDailyBars').mockResolvedValue([])

    const picks = await getPastPicks(NOW)

    expect(picks).toHaveLength(1)
    expect(picks[0]).toMatchObject({ symbol: 'OLD', name: 'Old Inc', firstScore: 70, entryPrice: 100, priceNow: 120, returnPct: 20, days: 30, marketPct: null })
  })
})
