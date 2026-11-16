import { describe, expect, it } from 'vitest'
import type { PricePoint } from '@/lib/history'
import { formatPct, periodReturns, yearlyReturns } from '@/lib/performance'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const p = (iso: string, close: number): PricePoint => ({ t: at(iso), close })
const NOW = new Date('2026-11-16T09:00:00Z')

describe('periodReturns', () => {
  const series = [
    p('2021-11-16', 50),
    p('2023-11-16', 80),
    p('2025-11-14', 100),
    p('2025-12-31', 110),
    p('2026-05-15', 120),
    p('2026-10-16', 125),
    p('2026-11-13', 150),
  ]

  it('measures each period against the last close on or before its start date', () => {
    const byKey = Object.fromEntries(periodReturns(series, NOW).map((r) => [r.key, r.returnPct]))
    expect(byKey['1M']).toBeCloseTo(20)
    expect(byKey['6M']).toBeCloseTo(25)
    expect(byKey.YTD).toBeCloseTo((150 / 110 - 1) * 100)
    expect(byKey['1A']).toBeCloseTo(50)
    expect(byKey['3A']).toBeCloseTo(87.5)
    expect(byKey['5A']).toBeCloseTo(200)
    expect(byKey.MAX).toBeCloseTo(200)
  })

  it('omits periods longer than the history and keeps a fixed order', () => {
    expect(periodReturns(series, NOW).map((r) => r.key)).toEqual(['1M', '6M', 'YTD', '1A', '3A', '5A', 'MAX'])
  })

  it('clamps the start date to the end of a shorter month', () => {
    const points = [p('2024-02-28', 90), p('2024-02-29', 100), p('2024-03-01', 105), p('2024-03-28', 110)]
    const oneMonth = periodReturns(points, new Date('2024-03-31T09:00:00Z')).find((r) => r.key === '1M')
    expect(oneMonth?.returnPct).toBeCloseTo(10)
  })

  it('omits short periods when the last close is older than their start date', () => {
    const stale = [p('2025-06-02', 10), p('2025-12-30', 20), p('2026-01-09', 30)]
    expect(periodReturns(stale, NOW).map((r) => r.key)).toEqual(['YTD', '1A', 'MAX'])
  })

  it('works on mixed-step series by date, not by index', () => {
    const mixed = [p('2016-10-31', 10), p('2016-11-30', 20), p('2026-11-12', 38), p('2026-11-13', 40)]
    const tenYears = periodReturns(mixed, NOW).find((r) => r.key === '10A')
    expect(tenYears?.returnPct).toBeCloseTo(300)
  })

  it('returns nothing for an empty or single-point series', () => {
    expect(periodReturns([], NOW)).toEqual([])
    expect(periodReturns([p('2026-11-13', 10)], NOW)).toEqual([])
  })

  it('skips a period whose reference close is not positive', () => {
    const points = [p('2020-01-02', 0), p('2026-11-13', 10)]
    expect(periodReturns(points, NOW)).toEqual([])
  })
})

describe('yearlyReturns', () => {
  it('compares each year-end close with the previous year-end close', () => {
    const points = [p('2023-06-01', 100), p('2023-12-29', 120), p('2024-12-31', 90), p('2025-12-31', 135), p('2026-11-13', 150)]
    const years = yearlyReturns(points, NOW)
    expect(years.map((y) => y.year)).toEqual([2023, 2024, 2025, 2026])
    expect(years[0]).toMatchObject({ partial: true })
    expect(years[0].returnPct).toBeCloseTo(20)
    expect(years[1]).toMatchObject({ partial: false })
    expect(years[1].returnPct).toBeCloseTo(-25)
    expect(years[2].returnPct).toBeCloseTo(50)
    expect(years[3]).toMatchObject({ partial: true })
    expect(years[3].returnPct).toBeCloseTo((150 / 135 - 1) * 100)
  })

  it('uses the latest earlier close when a calendar year has no data', () => {
    const points = [p('2020-01-02', 80), p('2020-12-31', 100), p('2022-12-30', 150)]
    const years = yearlyReturns(points, NOW)
    expect(years.map((y) => y.year)).toEqual([2020, 2022])
    expect(years[1].returnPct).toBeCloseTo(50)
    expect(years[1].partial).toBe(false)
  })

  it('skips a first year that has a single close', () => {
    const points = [p('2023-12-29', 100), p('2024-12-31', 110)]
    expect(yearlyReturns(points, NOW)).toEqual([{ year: 2024, returnPct: expect.closeTo(10), partial: false }])
  })

  it('returns nothing for an empty series', () => {
    expect(yearlyReturns([], NOW)).toEqual([])
  })
})

describe('formatPct', () => {
  it('uses an Italian decimal comma, one decimal and an explicit sign', () => {
    expect(formatPct(12.34)).toBe('+12,3%')
    expect(formatPct(-66.04)).toBe('−66,0%')
  })

  it('never shows a signed zero', () => {
    expect(formatPct(0)).toBe('0,0%')
    expect(formatPct(-0.04)).toBe('0,0%')
  })

  it('drops decimals and groups thousands for extreme returns', () => {
    expect(formatPct(412345.6)).toBe('+412.346%')
  })
})
