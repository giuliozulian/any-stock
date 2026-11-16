import type { PricePoint } from '@/lib/history'

const DAY_MS = 86_400_000
// Friday to Tuesday over a long weekend is four days; anything longer is not daily data.
const MAX_GAP_DAYS = 4

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
