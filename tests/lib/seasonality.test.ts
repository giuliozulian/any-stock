import { describe, expect, it } from 'vitest'
import type { PricePoint } from '@/lib/history'
import { completeYears, electionCycle, monthlyReturns, monthStats, seasonalCurve, seasonality, weekdayStats, yearCurve } from '@/lib/seasonality'

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

// Every year: +10% by 31 January, +20% by 30 June, +100% by 31 December.
function yearly(fromYear: number, toYear: number): PricePoint[] {
  const out = [p(`${fromYear - 1}-12-31`, 100)]
  let base = 100
  for (let year = fromYear; year <= toYear; year++) {
    out.push(p(`${year}-01-31`, base * 1.1), p(`${year}-06-30`, base * 1.2), p(`${year}-12-31`, base * 2))
    base *= 2
  }
  return out
}

describe('yearCurve', () => {
  it('holds the last value between closes and starts at zero', () => {
    const curve = yearCurve([p('2025-01-31', 110), p('2025-06-30', 120), p('2025-12-31', 200)], 100)
    expect(curve).toHaveLength(365)
    expect(curve[0]).toBe(0)
    expect(curve[29]).toBe(0)
    expect(curve[30]).toBeCloseTo(10)
    expect(curve[179]).toBeCloseTo(10)
    expect(curve[180]).toBeCloseTo(20)
    expect(curve[363]).toBeCloseTo(20)
    expect(curve[364]).toBeCloseTo(100)
  })

  it('skips 29 February so every year has 365 days', () => {
    const curve = yearCurve([p('2024-02-28', 110), p('2024-02-29', 150), p('2024-03-01', 120)], 100)
    expect(curve).toHaveLength(365)
    expect(curve[58]).toBeCloseTo(10)
    expect(curve[59]).toBeCloseTo(20)
    expect(curve).not.toContain(50)
  })

  it('can stop at a given day', () => {
    const curve = yearCurve([p('2025-01-31', 110), p('2025-06-30', 120), p('2025-12-31', 200)], 100, 181)
    expect(curve).toHaveLength(181)
    expect(curve[180]).toBeCloseTo(20)
  })
})

describe('seasonalCurve', () => {
  it('equals a single year when every year moves the same way', () => {
    const curve = seasonalCurve(yearly(2020, 2025), [2023, 2024, 2025])
    expect(curve).toHaveLength(365)
    expect(curve[30]).toBeCloseTo(10)
    expect(curve[180]).toBeCloseTo(20)
    expect(curve[364]).toBeCloseTo(100)
  })

  it('averages the years day by day', () => {
    const points = [p('2022-12-30', 100), p('2023-06-30', 150), p('2023-12-29', 100), p('2024-06-28', 50), p('2024-12-31', 100)]
    const curve = seasonalCurve(points, [2023, 2024])
    expect(curve[177]).toBeCloseTo(0)
    expect(curve[178]).toBeCloseTo(-25)
    expect(curve[180]).toBeCloseTo(0)
    expect(curve[362]).toBeCloseTo(-25)
    expect(curve[364]).toBeCloseTo(0)
  })
})

describe('electionCycle', () => {
  it('groups yearly returns by position in the US presidential cycle', () => {
    const points = [p('2019-12-31', 100), p('2020-12-31', 50), p('2021-12-31', 100), p('2022-12-30', 100), p('2023-12-29', 110), p('2024-12-31', 220)]
    const cycle = electionCycle(points, NOW, [2020, 2021, 2022, 2023, 2024])
    expect(cycle.map((c) => c.key)).toEqual(['election', 'post', 'midterm', 'pre'])
    expect(cycle[0]).toMatchObject({ positive: 1, count: 2 })
    expect(cycle[0].avgPct).toBeCloseTo(25)
    expect(cycle[2]).toMatchObject({ avgPct: 0, positive: 0, count: 1 })
    expect(cycle[3].avgPct).toBeCloseTo(10)
  })

  it('leaves out a cycle year with no data', () => {
    const cycle = electionCycle(yearly(2021, 2023), NOW, [2021, 2022, 2023])
    expect(cycle.map((c) => c.key)).toEqual(['post', 'midterm', 'pre'])
  })
})

describe('seasonality', () => {
  // 100 at the end of 2013, doubling every year: 409600 at the end of 2025.
  const points = [...yearly(2014, 2025), p('2026-10-30', 409600 * 1.2), p('2026-11-13', 409600 * 1.5)]
  const result = seasonality(points, NOW)!

  it('offers the windows the history covers and defaults to ten years', () => {
    expect(result.windows.map((w) => w.key)).toEqual(['5', '10', 'all'])
    expect(result.defaultWindow).toBe('10')
    expect(result.windows.map((w) => [w.fromYear, w.toYear])).toEqual([
      [2021, 2025],
      [2016, 2025],
      [2014, 2025],
    ])
  })

  it.each([
    [2023, ['all'], 'all'],
    [2019, ['5', 'all'], 'all'],
    [2001, ['5', '10', '20', 'all'], '10'],
  ])('with history from %i offers %j and defaults to %s', (fromYear, keys, fallback) => {
    const short = seasonality(yearly(fromYear, 2025), NOW)!
    expect(short.windows.map((w) => w.key)).toEqual(keys)
    expect(short.defaultWindow).toBe(fallback)
  })

  it('returns null with fewer than three complete years, or no data', () => {
    expect(seasonality(yearly(2024, 2025), NOW)).toBeNull()
    expect(seasonality([], NOW)).toBeNull()
  })

  it('computes each window on its own years', () => {
    const ten = result.windows[1]
    expect(ten.months).toHaveLength(1)
    expect(ten.months[0]).toMatchObject({ month: 0, positive: 10, count: 10 })
    expect(ten.months[0].avgPct).toBeCloseTo(10)
    expect(result.windows[2].months[0].count).toBe(12)
    expect(ten.curve[364]).toBeCloseTo(100)
    expect(ten.weekdays).toEqual([])
  })

  it('lists the current year first, flagged partial, then complete years newest first', () => {
    expect(result.years).toHaveLength(13)
    expect(result.years[0]).toMatchObject({ year: 2026, partial: true })
    expect(result.years[0].months[9]).toBeNull()
    expect(result.years[0].months[10]).toBeCloseTo(25)
    expect(result.years[0].returnPct).toBeCloseTo(50)
    expect(result.years[1]).toMatchObject({ year: 2025, partial: false })
    expect(result.years[1].months[0]).toBeCloseTo(10)
    expect(result.years[1].months[5]).toBeNull()
    expect(result.years[1].returnPct).toBeCloseTo(100)
    expect(result.years[12].year).toBe(2014)
  })

  it('describes today: months to highlight, day of the year, cycle year', () => {
    expect(result).toMatchObject({ currentYear: 2026, currentMonth: 10, nextMonth: 11, todayIndex: 319, currentCycle: 'midterm' })
    expect(result.electionCycle.map((c) => c.count)).toEqual([3, 3, 3, 3])
  })

  it('draws the current year up to today', () => {
    expect(result.currentYearCurve).toHaveLength(320)
    expect(result.currentYearCurve[301]).toBe(0)
    expect(result.currentYearCurve[302]).toBeCloseTo(20)
    expect(result.currentYearCurve[316]).toBeCloseTo(50)
    expect(result.currentYearCurve[319]).toBeCloseTo(50)
  })

  it('follows December with January', () => {
    expect(seasonality(points, new Date('2026-12-10T09:00:00Z'))).toMatchObject({ currentMonth: 11, nextMonth: 0 })
  })

  it('puts the today marker on 28 February when today is 29 February', () => {
    expect(seasonality(yearly(2014, 2027), new Date('2028-02-29T09:00:00Z'))?.todayIndex).toBe(58)
  })

  it('has no current-year row or curve before the first close of the year', () => {
    const early = seasonality(yearly(2014, 2026), new Date('2027-01-01T09:00:00Z'))!
    expect(early.years[0]).toMatchObject({ year: 2026, partial: false })
    expect(early.currentYearCurve).toEqual([])
  })

  it('keeps a stale ticker flat: empty current month, last value held to today', () => {
    const stale = seasonality([...yearly(2014, 2025), p('2026-03-31', 409600 * 1.3)], NOW)!
    expect(stale.years[0].months[10]).toBeNull()
    expect(stale.currentYearCurve).toHaveLength(320)
    expect(stale.currentYearCurve[319]).toBeCloseTo(30)
  })
})
