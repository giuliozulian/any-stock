import { describe, expect, it } from 'vitest'
import type { PricePoint } from '@/lib/history'
import { completeYears, monthlyReturns, monthStats, weekdayStats } from '@/lib/seasonality'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const p = (iso: string, close: number): PricePoint => ({ t: at(iso), close })
const NOW = new Date('2026-11-16T09:00:00Z')

describe('monthlyReturns', () => {
  const grid = monthlyReturns([p('2025-11-28', 100), p('2025-12-30', 110), p('2025-12-31', 120), p('2026-01-30', 90), p('2026-03-31', 99)])

  it('measures each month from the last close of the month before', () => {
    expect(grid.get(2025)?.[11]).toBeCloseTo(20)
    expect(grid.get(2026)?.[0]).toBeCloseTo(-25)
  })

  it('leaves a month empty when it, or the month before, has no close', () => {
    expect(grid.get(2025)?.[10]).toBeNull()
    expect(grid.get(2026)?.[1]).toBeNull()
    expect(grid.get(2026)?.[2]).toBeNull()
    expect(grid.get(2026)).toHaveLength(12)
  })

  it('returns an empty grid for an empty series', () => {
    expect(monthlyReturns([]).size).toBe(0)
  })
})

describe('completeYears', () => {
  it('keeps past years that have data in that year and in the one before', () => {
    const points = [p('2019-12-31', 1), p('2020-12-31', 2), p('2022-12-30', 3), p('2023-12-29', 4)]
    expect(completeYears(points, NOW)).toEqual([2020, 2023])
  })

  it('never includes the year of now', () => {
    const points = [p('2024-12-31', 1), p('2025-12-31', 2), p('2026-06-30', 3)]
    expect(completeYears(points, NOW)).toEqual([2025])
  })
})

describe('monthStats', () => {
  const row = (jan: number | null, feb: number | null) => [jan, feb, ...new Array<number | null>(10).fill(null)]
  const grid = new Map([
    [2023, row(10, null)],
    [2024, row(-4, 6)],
    [2025, row(0, null)],
  ])

  it('averages each month over the years that have a value', () => {
    expect(monthStats(grid, [2023, 2024, 2025])).toEqual([
      { month: 0, avgPct: 2, positive: 1, count: 3 },
      { month: 1, avgPct: 6, positive: 1, count: 1 },
    ])
  })

  it('uses only the years asked for, and does not count zero as positive', () => {
    expect(monthStats(grid, [2024, 2025])).toEqual([
      { month: 0, avgPct: -2, positive: 0, count: 2 },
      { month: 1, avgPct: 6, positive: 1, count: 1 },
    ])
  })
})

describe('weekdayStats', () => {
  // 6 November 2026 is a Friday.
  const points = [
    p('2026-11-06', 100),
    p('2026-11-09', 110),
    p('2026-11-10', 99),
    p('2026-11-11', 99),
    p('2026-11-13', 108.9),
    p('2026-11-20', 200),
    p('2026-11-23', 220),
  ]

  it('averages daily returns by weekday and skips gaps longer than four days', () => {
    const stats = weekdayStats(points, [2026])
    expect(stats.map((s) => s.weekday)).toEqual([1, 2, 3, 5])
    expect(stats[0]).toMatchObject({ positiveSharePct: 100, count: 2 })
    expect(stats[0].avgPct).toBeCloseTo(10)
    expect(stats[1].avgPct).toBeCloseTo(-10)
    expect(stats[1].positiveSharePct).toBe(0)
    expect(stats[2]).toMatchObject({ avgPct: 0, positiveSharePct: 0, count: 1 })
    expect(stats[3].count).toBe(1)
    expect(stats[3].avgPct).toBeCloseTo(10)
  })

  it('gives the return over a long weekend to the day trading resumes', () => {
    const stats = weekdayStats([p('2026-11-13', 100), p('2026-11-17', 105)], [2026])
    expect(stats).toHaveLength(1)
    expect(stats[0].weekday).toBe(2)
    expect(stats[0].avgPct).toBeCloseTo(5)
  })

  it('ignores days outside the years asked for', () => {
    expect(weekdayStats(points, [2025])).toEqual([])
  })
})
