import { describe, expect, it } from 'vitest'
import { dividendSummary, type DividendFrequency, type DividendPayment } from '@/lib/dividends'

const DAY_MS = 86_400_000
const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const pay = (iso: string, amount: number): DividendPayment => ({ t: at(iso), amount })
const NOW = new Date('2026-11-16T09:00:00Z')

// n payments spread evenly over the year, on the 10th of the month.
const spread = (year: number, n: number, amount = 1): DividendPayment[] =>
  Array.from({ length: n }, (_, i) => pay(`${year}-${String(Math.floor((i * 12) / n) + 1).padStart(2, '0')}-10`, amount))

// Quarterly payer raising every payment each year, 2021 to 2026: 0.40, 0.42 ... 0.50.
const RAISING = [2021, 2022, 2023, 2024, 2025, 2026].flatMap((year, i) => spread(year, 4, 0.4 + i * 0.02))

// Annual payer on 1 June: 0.5 in 2014, then 1, 2, 4 ... doubling every year up to 2026.
const DOUBLING = [pay('2014-06-01', 0.5), ...Array.from({ length: 12 }, (_, i) => pay(`${2015 + i}-06-01`, 2 ** i))]

describe('dividendSummary', () => {
  it('lists every year from the first payment, flagging the first and the current as partial', () => {
    const years = dividendSummary(RAISING, NOW, 100)!.years
    expect(years.map((y) => [y.year, y.count, y.partial])).toEqual([
      [2021, 4, true],
      [2022, 4, false],
      [2023, 4, false],
      [2024, 4, false],
      [2025, 4, false],
      [2026, 4, true],
    ])
    expect(years.map((y) => y.total)).toEqual([1.6, 1.68, 1.76, 1.84, 1.92, 2])
  })

  it('reports the last payment, the trailing twelve months and the yield on the price', () => {
    const summary = dividendSummary(RAISING, NOW, 100)!
    expect(summary.lastPayment.t).toBe(at('2026-10-10'))
    expect(summary.lastPayment.amount).toBeCloseTo(0.5)
    expect(summary.ttmTotal).toBeCloseTo(2)
    expect(summary.yieldPct).toBeCloseTo(2)
  })

  it('leaves the yield empty without a usable price', () => {
    expect(dividendSummary(RAISING, NOW, null)!.yieldPct).toBeNull()
    expect(dividendSummary(RAISING, NOW, 0)!.yieldPct).toBeNull()
    expect(dividendSummary(RAISING, NOW, -5)!.yieldPct).toBeNull()
  })

  it('ignores payments dated after now', () => {
    const summary = dividendSummary([...RAISING, pay('2026-12-10', 0.9)], NOW, 100)!
    expect(summary.lastPayment.t).toBe(at('2026-10-10'))
    expect(summary.years[summary.years.length - 1].total).toBe(2)
  })

  it('returns null when no payment is dated on or before now', () => {
    expect(dividendSummary([], NOW, 100)).toBeNull()
    expect(dividendSummary([pay('2026-12-10', 1)], NOW, 100)).toBeNull()
  })

  it.each<[number, DividendFrequency]>([
    [12, 'monthly'],
    [4, 'quarterly'],
    [2, 'semiannual'],
    [1, 'annual'],
    [6, 'irregular'],
  ])('classifies %i payments a year as %s', (n, expected) => {
    const history = [2021, 2022, 2023, 2024, 2025].flatMap((year) => spread(year, n))
    expect(dividendSummary(history, NOW, 100)!.frequency).toBe(expected)
  })

  it('handles a single payment: no frequency, one partial year, no growth', () => {
    const summary = dividendSummary([pay('2026-05-04', 0.25)], NOW, 50)!
    expect(summary.frequency).toBeNull()
    expect(summary.suspended).toBe(false)
    expect(summary.years).toEqual([{ year: 2026, total: 0.25, count: 1, partial: true }])
    expect(summary.yieldPct).toBeCloseTo(0.5)
    expect(summary.growth).toEqual({ completeYears: 0, firstCompleteYear: null, consecutiveIncreases: 0, cagr5Pct: null, cagr10Pct: null, cutYears: [] })
  })

  it('applies a fixed 400-day limit when there is no regular rhythm', () => {
    expect(dividendSummary([pay('2025-10-10', 1)], NOW, 100)!.suspended).toBe(true)
    expect(dividendSummary([pay('2025-11-01', 1)], NOW, 100)!.suspended).toBe(false)
  })

  it('calls a quarterly payer suspended once 1.5 intervals have passed', () => {
    const history = [2021, 2022, 2023, 2024, 2025].flatMap((year) => spread(year, 4))
    const last = at('2025-10-10')
    expect(dividendSummary(history, new Date(last + 136 * DAY_MS), 100)!.suspended).toBe(false)
    expect(dividendSummary(history, new Date(last + 137 * DAY_MS), 100)!.suspended).toBe(true)
  })

  it('counts consecutive yearly increases on complete years, with no CAGR when the history is short', () => {
    expect(dividendSummary(RAISING, NOW, 100)!.growth).toEqual({
      completeYears: 4,
      firstCompleteYear: 2022,
      consecutiveIncreases: 3,
      cagr5Pct: null,
      cagr10Pct: null,
      cutYears: [],
    })
  })

  it('computes the compound yearly growth over 5 and 10 years', () => {
    const summary = dividendSummary(DOUBLING, NOW, 100)!
    expect(summary.frequency).toBe('annual')
    expect(summary.suspended).toBe(false)
    expect(summary.growth.completeYears).toBe(11)
    expect(summary.growth.firstCompleteYear).toBe(2015)
    expect(summary.growth.consecutiveIncreases).toBe(10)
    expect(summary.growth.cagr5Pct).toBeCloseTo(100, 6)
    expect(summary.growth.cagr10Pct).toBeCloseTo(100, 6)
    expect(summary.growth.cutYears).toEqual([])
  })

  it('gives no CAGR when the base year paid nothing, and counts the empty year as a cut', () => {
    const summary = dividendSummary(
      DOUBLING.filter((p) => new Date(p.t).getUTCFullYear() !== 2020),
      NOW,
      100,
    )!
    expect(summary.growth.cagr5Pct).toBeNull()
    expect(summary.growth.cagr10Pct).toBeCloseTo(100, 6)
    expect(summary.growth.cutYears).toEqual([2020])
    expect(summary.growth.consecutiveIncreases).toBe(5)
  })

  it('counts a cut only below 95% of the year before, and keeps empty years in the list', () => {
    const history = [pay('2014-06-01', 1), pay('2015-06-01', 1), pay('2016-06-01', 0.96), pay('2017-06-01', 0.5), pay('2018-06-01', 0.75), pay('2020-06-01', 0.8)]
    const summary = dividendSummary(history, new Date('2021-11-16T09:00:00Z'), 100)!
    expect(summary.growth.cutYears).toEqual([2017, 2019])
    expect(summary.growth.consecutiveIncreases).toBe(1)
    expect(summary.growth.completeYears).toBe(6)
    expect(summary.growth.firstCompleteYear).toBe(2015)
    expect(summary.growth.cagr5Pct).toBeCloseTo(-4.37, 1)
    expect(summary.growth.cagr10Pct).toBeNull()
    expect(summary.years.find((y) => y.year === 2019)).toEqual({ year: 2019, total: 0, count: 0, partial: false })
  })
})
