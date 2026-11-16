import { describe, expect, it } from 'vitest'
import type { PricePoint } from '@/lib/history'
import { downsample, drawdownSeries, drawdownSummary, formatPct, periodReturns, yearlyReturns } from '@/lib/performance'

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

describe('drawdownSeries', () => {
  it('measures each close against the highest close so far', () => {
    const points = [p('2026-01-05', 100), p('2026-02-02', 120), p('2026-03-02', 60), p('2026-04-01', 90), p('2026-05-04', 130), p('2026-06-01', 117)]
    const series = drawdownSeries(points)
    expect(series.map((d) => d.t)).toEqual(points.map((x) => x.t))
    const expected = [0, 0, -50, -25, 0, -10]
    series.forEach((d, i) => expect(d.drawdownPct).toBeCloseTo(expected[i]))
  })

  it('returns an empty series for no points', () => {
    expect(drawdownSeries([])).toEqual([])
  })
})

describe('drawdownSummary', () => {
  it('reports the current drawdown and the deepest one with its dates', () => {
    const points = [p('2026-01-05', 100), p('2026-02-02', 120), p('2026-03-02', 60), p('2026-04-01', 90), p('2026-10-05', 130), p('2026-11-13', 117)]
    const summary = drawdownSummary(points, NOW)!
    expect(summary.currentPct).toBeCloseTo(-10)
    expect(summary.peakT).toBe(at('2026-10-05'))
    expect(summary.daysSincePeak).toBe(42)
    expect(summary.maxPct).toBeCloseTo(-50)
    expect(summary.maxPeakT).toBe(at('2026-02-02'))
    expect(summary.maxTroughT).toBe(at('2026-03-02'))
  })

  it('reports zero current drawdown when the last close is the high', () => {
    const summary = drawdownSummary([p('2026-01-05', 100), p('2026-02-02', 80), p('2026-11-13', 120)], NOW)!
    expect(summary.currentPct).toBe(0)
    expect(summary.peakT).toBe(at('2026-11-13'))
    expect(summary.maxPct).toBeCloseTo(-20)
  })

  it('reports no historical drawdown for a series that only rises', () => {
    const summary = drawdownSummary([p('2026-01-05', 1), p('2026-02-02', 2), p('2026-03-02', 3)], NOW)!
    expect(summary.maxPct).toBe(0)
    expect(summary.currentPct).toBe(0)
  })

  it('measures from the most recent time the high was touched', () => {
    const summary = drawdownSummary([p('2026-01-05', 100), p('2026-06-01', 100), p('2026-11-13', 90)], NOW)!
    expect(summary.peakT).toBe(at('2026-06-01'))
  })

  it('returns null with fewer than two points', () => {
    expect(drawdownSummary([], NOW)).toBeNull()
    expect(drawdownSummary([p('2026-11-13', 10)], NOW)).toBeNull()
  })
})

describe('downsample', () => {
  it('keeps the last point of each week before the five-year mark and every point after it', () => {
    const old = ['2020-01-06', '2020-01-07', '2020-01-08', '2020-01-09', '2020-01-10', '2020-01-13', '2020-01-14', '2020-01-17'].map((d, i) => p(d, i + 1))
    const recent = [p('2026-11-11', 50), p('2026-11-12', 51), p('2026-11-13', 52)]
    const out = downsample([...old, ...recent], NOW)
    expect(out.map((x) => x.close)).toEqual([5, 8, 50, 51, 52])
  })

  it('preserves the extra fields of the points it keeps', () => {
    const series = [{ t: at('2019-03-04'), drawdownPct: -1 }, { t: at('2019-03-05'), drawdownPct: -2 }]
    expect(downsample(series, NOW)).toEqual([{ t: at('2019-03-05'), drawdownPct: -2 }])
  })

  it('returns an empty list for no points', () => {
    expect(downsample([], NOW)).toEqual([])
  })
})
