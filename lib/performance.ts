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

export interface DrawdownPoint {
  t: number
  drawdownPct: number
}

export interface DrawdownSummary {
  currentPct: number
  peakT: number
  daysSincePeak: number
  maxPct: number
  maxPeakT: number
  maxTroughT: number
}

// Distance of each close from the highest close reached up to that point (0 or negative).
export function drawdownSeries(points: PricePoint[]): DrawdownPoint[] {
  let peak = 0
  return points.map((p) => {
    if (p.close > peak) peak = p.close
    return { t: p.t, drawdownPct: peak > 0 ? pct(p.close, peak) : 0 }
  })
}

export function drawdownSummary(points: PricePoint[], now: Date): DrawdownSummary | null {
  if (points.length < 2) return null
  let peak = points[0]
  let maxPct = 0
  let maxPeakT = points[0].t
  let maxTroughT = points[0].t
  for (const p of points) {
    // >= so the current drawdown is dated from the latest time the high was touched.
    if (p.close >= peak.close) {
      peak = p
    } else if (peak.close > 0) {
      const drawdown = pct(p.close, peak.close)
      if (drawdown < maxPct) {
        maxPct = drawdown
        maxPeakT = peak.t
        maxTroughT = p.t
      }
    }
  }
  const last = points[points.length - 1]
  return {
    currentPct: last === peak || peak.close <= 0 ? 0 : pct(last.close, peak.close),
    peakT: peak.t,
    daysSincePeak: Math.max(0, Math.floor(now.getTime() / DAY_MS) - Math.floor(peak.t / DAY_MS)),
    maxPct,
    maxPeakT,
    maxTroughT,
  }
}

// Series for the browser: every point of the last five years, one per week (its last) before that.
export function downsample<T extends { t: number }>(points: T[], now: Date): T[] {
  const cutoff = monthsBefore(now, 60)
  const out: T[] = []
  let week: number | null = null
  for (const p of points) {
    if (p.t > cutoff) {
      out.push(p)
      continue
    }
    // 1 January 1970 was a Thursday; +3 makes weeks roll over on Monday.
    const w = Math.floor((p.t / DAY_MS + 3) / 7)
    if (w === week) out[out.length - 1] = p
    else out.push(p)
    week = w
  }
  return out
}
