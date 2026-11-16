import type { PricePoint } from '@/lib/history'

const DAY_MS = 86_400_000

export type PeriodKey = '1M' | '6M' | 'YTD' | '1A' | '3A' | '5A' | '10A' | '20A' | 'MAX'

export interface PeriodReturn {
  key: PeriodKey
  returnPct: number
}

export interface YearReturn {
  year: number
  returnPct: number
  partial: boolean
}

function pct(value: number, reference: number): number {
  return (value / reference - 1) * 100
}

// Last millisecond of the UTC day `months` before `now`; 31 March minus one month is the last day of February.
function monthsBefore(now: Date, months: number): number {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() - months
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Date.UTC(year, month, Math.min(now.getUTCDate(), lastDay)) + DAY_MS - 1
}

function lastIndexAtOrBefore(points: PricePoint[], cutoff: number): number {
  let lo = 0
  let hi = points.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= cutoff) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

// Price return of the latest close over each horizon. Horizons the series does not reach back to are left out.
export function periodReturns(points: PricePoint[], now: Date): PeriodReturn[] {
  if (points.length < 2) return []
  const lastIndex = points.length - 1
  const last = points[lastIndex].close
  const out: PeriodReturn[] = []
  const add = (key: PeriodKey, refIndex: number) => {
    // refIndex === lastIndex means the latest close is older than the horizon start: nothing to measure.
    if (refIndex < 0 || refIndex >= lastIndex) return
    const reference = points[refIndex].close
    if (reference > 0) out.push({ key, returnPct: pct(last, reference) })
  }
  const cutoffs: Array<[PeriodKey, number]> = [
    ['1M', monthsBefore(now, 1)],
    ['6M', monthsBefore(now, 6)],
    ['YTD', Date.UTC(now.getUTCFullYear(), 0, 1) - 1],
    ['1A', monthsBefore(now, 12)],
    ['3A', monthsBefore(now, 36)],
    ['5A', monthsBefore(now, 60)],
    ['10A', monthsBefore(now, 120)],
    ['20A', monthsBefore(now, 240)],
  ]
  for (const [key, cutoff] of cutoffs) add(key, lastIndexAtOrBefore(points, cutoff))
  add('MAX', 0)
  return out
}

// One entry per calendar year with data. The listing year and the year of `now` are flagged partial.
export function yearlyReturns(points: PricePoint[], now: Date): YearReturn[] {
  const currentYear = now.getUTCFullYear()
  const out: YearReturn[] = []
  let previousClose: number | null = null
  let i = 0
  while (i < points.length) {
    const year = new Date(points[i].t).getUTCFullYear()
    let j = i
    while (j + 1 < points.length && new Date(points[j + 1].t).getUTCFullYear() === year) j++
    const first = previousClose === null
    const reference = previousClose ?? points[i].close
    const hasRange = !first || j > i
    if (year <= currentYear && reference > 0 && hasRange) {
      out.push({ year, returnPct: pct(points[j].close, reference), partial: first || year === currentYear })
    }
    previousClose = points[j].close
    i = j + 1
  }
  return out
}

export function formatPct(value: number): string {
  const digits = Math.abs(value) >= 1000 ? 0 : 1
  const rounded = Number(value.toFixed(digits))
  const body = Math.abs(rounded).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${body}%`
}
