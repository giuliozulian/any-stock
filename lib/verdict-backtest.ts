import type { Bar } from './history'
import type { Tone } from './evaluate'

export const HORIZONS = [10, 30, 90] as const
export type Horizon = (typeof HORIZONS)[number]
export const NEUTRAL_BAND_PCT = 2

export type Result = 'win' | 'loss' | 'neutral'

// UTC day of a bar. Yahoo stamps each daily bar at the market's own open, which is the same UTC day on every exchange.
export const barDay = (t: number): string => new Date(t).toISOString().slice(0, 10)

// A positive verdict wins on a rise of at least the band, a negative one on a fall. Neutral and missing signals have no result.
export function resultOf(tone: Tone, pct: number, band = NEUTRAL_BAND_PCT): Result | null {
  if (tone === 'neutral' || tone === 'unknown') return null
  const signed = tone === 'positive' ? pct : -pct
  return signed >= band ? 'win' : signed <= -band ? 'loss' : 'neutral'
}

export interface PendingVerdict {
  refDate: string
  refPrice: number
}

export interface OutcomeReturns {
  evalDate: string
  stockReturnPct: number
  benchReturnPct: number
  excessPct: number
}

// Index of the last bar on or before a day, -1 when the series starts later. Bars are sorted by time.
function lastIndexOnOrBefore(bars: Bar[], day: string): number {
  let found = -1
  for (let i = 0; i < bars.length; i++) {
    if (barDay(bars[i].t) <= day) found = i
    else break
  }
  return found
}

// Returns over `horizon` trading days from the reference bar, or null while it cannot be measured safely (not matured, data missing).
export function measureReturns(v: PendingVerdict, horizon: number, stock: Bar[], bench: Bar[]): OutcomeReturns | null {
  if (v.refPrice <= 0) return null
  const start = lastIndexOnOrBefore(stock, v.refDate)
  // The reference bar itself must exist, otherwise the day count would be off.
  if (start < 0 || barDay(stock[start].t) !== v.refDate) return null
  const end = start + horizon
  if (end >= stock.length) return null
  const evalDate = barDay(stock[end].t)

  const benchStart = lastIndexOnOrBefore(bench, v.refDate)
  const benchEnd = lastIndexOnOrBefore(bench, evalDate)
  if (benchStart < 0 || benchEnd <= benchStart || barDay(bench[bench.length - 1].t) < evalDate) return null

  const stockReturnPct = ((stock[end].close - v.refPrice) / v.refPrice) * 100
  const benchReturnPct = ((bench[benchEnd].close - bench[benchStart].close) / bench[benchStart].close) * 100
  return { evalDate, stockReturnPct, benchReturnPct, excessPct: stockReturnPct - benchReturnPct }
}

const DAY_MS = 86_400_000

// N trading days take at least N × 7/5 calendar days (holidays only lengthen it): below that, do not even download the bars.
export function dueHorizons(refDate: string, done: number[], today: string): Horizon[] {
  return HORIZONS.filter((h) => {
    if (done.includes(h)) return false
    const earliest = new Date(Date.parse(`${refDate}T00:00:00Z`) + Math.ceil((h * 7) / 5) * DAY_MS).toISOString().slice(0, 10)
    return earliest <= today
  })
}
