import type { PricePoint } from '@/lib/history'
import { yearlyReturns } from '@/lib/performance'

const DAY_MS = 86_400_000
// Friday to Tuesday over a long weekend is four days; anything longer is not daily data.
const MAX_GAP_DAYS = 4
const MIN_YEARS = 3
const FIXED_WINDOWS = [5, 10, 20] as const
const DAYS_IN_YEAR = 365
// Day-of-year offset of each month in a non-leap year.
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
// Indexed by year modulo 4: 2024 was a US presidential election year.
const CYCLE_KEYS = ['election', 'post', 'midterm', 'pre'] as const

export type WindowKey = '5' | '10' | '20' | 'all'
export type CycleKey = (typeof CYCLE_KEYS)[number]

export interface SeasonalYear {
  year: number
  months: Array<number | null>
  returnPct: number | null
  partial: boolean
}

export interface CycleStat {
  key: CycleKey
  avgPct: number
  positive: number
  count: number
}

export interface MonthStat {
  month: number
  avgPct: number
  positive: number
  count: number
}

export interface WeekdayStat {
  weekday: number
  avgPct: number
  positiveSharePct: number
  count: number
}

function pct(value: number, reference: number): number {
  return (value / reference - 1) * 100
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

// Month-over-month return for every year with data; index 0 is January. A month with no close, or none the month before, is null.
export function monthlyReturns(points: PricePoint[]): Map<number, Array<number | null>> {
  const closes = new Map<number, number>()
  for (const point of points) {
    const date = new Date(point.t)
    closes.set(date.getUTCFullYear() * 12 + date.getUTCMonth(), point.close)
  }
  const grid = new Map<number, Array<number | null>>()
  for (const [key, close] of closes) {
    const year = Math.floor(key / 12)
    const row = grid.get(year) ?? new Array<number | null>(12).fill(null)
    const previous = closes.get(key - 1)
    if (previous !== undefined && previous > 0) row[key % 12] = pct(close, previous)
    grid.set(year, row)
  }
  return grid
}

// Years before the year of `now` with data both in that year and in the one before, oldest first.
export function completeYears(points: PricePoint[], now: Date): number[] {
  const withData = new Set(points.map((point) => new Date(point.t).getUTCFullYear()))
  const currentYear = now.getUTCFullYear()
  return [...withData].filter((year) => year < currentYear && withData.has(year - 1)).sort((a, b) => a - b)
}

export function monthStats(grid: Map<number, Array<number | null>>, years: number[]): MonthStat[] {
  const out: MonthStat[] = []
  for (let month = 0; month < 12; month++) {
    const values = years.map((year) => grid.get(year)?.[month] ?? null).filter((value): value is number => value !== null)
    if (values.length > 0) out.push({ month, avgPct: mean(values), positive: values.filter((value) => value > 0).length, count: values.length })
  }
  return out
}

// Average close-to-close return per weekday (1 Monday to 5 Friday) for the days falling in `years`.
export function weekdayStats(points: PricePoint[], years: number[]): WeekdayStat[] {
  const wanted = new Set(years)
  const buckets = new Map<number, number[]>()
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]
    const current = points[i]
    const date = new Date(current.t)
    const weekday = date.getUTCDay()
    if (weekday < 1 || weekday > 5 || !wanted.has(date.getUTCFullYear()) || previous.close <= 0) continue
    if (Math.floor(current.t / DAY_MS) - Math.floor(previous.t / DAY_MS) > MAX_GAP_DAYS) continue
    const bucket = buckets.get(weekday) ?? []
    bucket.push(pct(current.close, previous.close))
    buckets.set(weekday, bucket)
  }
  return [1, 2, 3, 4, 5].flatMap((weekday) => {
    const values = buckets.get(weekday)
    if (!values) return []
    return [{ weekday, avgPct: mean(values), positiveSharePct: (values.filter((value) => value > 0).length / values.length) * 100, count: values.length }]
  })
}

export interface SeasonalWindow {
  key: WindowKey
  fromYear: number
  toYear: number
  months: MonthStat[]
  curve: number[]
  weekdays: WeekdayStat[]
}

export interface Seasonality {
  years: SeasonalYear[]
  windows: SeasonalWindow[]
  defaultWindow: WindowKey
  currentYear: number
  currentYearCurve: number[]
  electionCycle: CycleStat[]
  currentCycle: CycleKey
  currentMonth: number
  nextMonth: number
  todayIndex: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function byYear(points: PricePoint[]): Map<number, PricePoint[]> {
  const groups = new Map<number, PricePoint[]>()
  for (const point of points) {
    const year = new Date(point.t).getUTCFullYear()
    const group = groups.get(year)
    if (group) group.push(point)
    else groups.set(year, [point])
  }
  return groups
}

function lastClose(points: PricePoint[] | undefined): number | null {
  const last = points?.[points.length - 1]
  return last && last.close > 0 ? last.close : null
}

// Position of a date in a 365-day year; 29 February has no slot.
function dayIndex(t: number): number | null {
  const date = new Date(t)
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  if (month === 1 && day === 29) return null
  return MONTH_START[month] + day - 1
}

// Return since `base` for each calendar day of one year: zero before the first close, then the last value seen.
export function yearCurve(yearPoints: PricePoint[], base: number, length = DAYS_IN_YEAR): number[] {
  const out = new Array<number>(length).fill(0)
  let cursor = 0
  let value = 0
  for (const point of yearPoints) {
    const index = dayIndex(point.t)
    if (index === null || index >= length) continue
    out.fill(value, cursor, index)
    value = pct(point.close, base)
    cursor = index
  }
  out.fill(value, cursor, length)
  return out
}

// Day-by-day average of the yearly curves of `years`, each measured from the last close of the year before.
export function seasonalCurve(points: PricePoint[], years: number[]): number[] {
  const groups = byYear(points)
  const sums = new Array<number>(DAYS_IN_YEAR).fill(0)
  let used = 0
  for (const year of years) {
    const base = lastClose(groups.get(year - 1))
    const own = groups.get(year)
    if (base === null || !own) continue
    yearCurve(own, base).forEach((value, i) => {
      sums[i] += value
    })
    used++
  }
  return sums.map((sum) => round2(used > 0 ? sum / used : 0))
}

export function electionCycle(points: PricePoint[], now: Date, years: number[]): CycleStat[] {
  const returns = new Map(yearlyReturns(points, now).map((entry) => [entry.year, entry.returnPct]))
  return CYCLE_KEYS.flatMap((key, remainder) => {
    const values = years
      .filter((year) => year % 4 === remainder)
      .map((year) => returns.get(year))
      .filter((value): value is number => value !== undefined)
    if (values.length === 0) return []
    return [{ key, avgPct: mean(values), positive: values.filter((value) => value > 0).length, count: values.length }]
  })
}

// Everything the seasonality tab shows, for every look-back window. Null when fewer than three complete years exist.
export function seasonality(points: PricePoint[], now: Date): Seasonality | null {
  const complete = completeYears(points, now)
  if (complete.length < MIN_YEARS) return null

  const currentYear = now.getUTCFullYear()
  const grid = monthlyReturns(points)
  const returns = new Map(yearlyReturns(points, now).map((entry) => [entry.year, entry.returnPct]))
  const row = (year: number, partial: boolean): SeasonalYear => ({
    year,
    months: grid.get(year) ?? new Array<number | null>(12).fill(null),
    returnPct: returns.get(year) ?? null,
    partial,
  })
  const years = [...complete].reverse().map((year) => row(year, false))
  if (grid.has(currentYear)) years.unshift(row(currentYear, true))

  const spans = FIXED_WINDOWS.filter((size) => complete.length >= size).map((size): [WindowKey, number[]] => [String(size) as WindowKey, complete.slice(-size)])
  spans.push(['all', complete])
  const windows = spans.map(([key, span]) => ({
    key,
    fromYear: span[0],
    toYear: span[span.length - 1],
    months: monthStats(grid, span),
    curve: seasonalCurve(points, span),
    weekdays: weekdayStats(points, span),
  }))

  const groups = byYear(points)
  // 29 February has no slot of its own: the marker stays on the 28th.
  const todayIndex = dayIndex(now.getTime()) ?? MONTH_START[2] - 1
  const base = lastClose(groups.get(currentYear - 1))
  const own = groups.get(currentYear)
  const currentMonth = now.getUTCMonth()

  return {
    years,
    windows,
    defaultWindow: windows.some((w) => w.key === '10') ? '10' : 'all',
    currentYear,
    currentYearCurve: base !== null && own ? yearCurve(own, base, todayIndex + 1).map(round2) : [],
    electionCycle: electionCycle(points, now, complete),
    currentCycle: CYCLE_KEYS[currentYear % 4],
    currentMonth,
    nextMonth: (currentMonth + 1) % 12,
    todayIndex,
  }
}
