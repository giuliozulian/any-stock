import type { Bar } from '@/lib/history'

const WEEK52 = 252
const SLOPE_BARS = 22
const QUARTER = 63

export function sma(values: number[], n: number, end = values.length): number | null {
  if (end < n || end > values.length) return null
  let sum = 0
  for (let i = end - n; i < end; i++) sum += values[i]
  return sum / n
}

// Quarterly returns over the last year, the most recent quarter counting double.
export function weightedReturn(closes: number[]): number | null {
  const n = closes.length
  if (n < QUARTER * 4 + 1) return null
  const ret = (k: number) => closes[n - 1 - k * QUARTER] / closes[n - 1 - (k + 1) * QUARTER] - 1
  return 0.4 * ret(0) + 0.2 * (ret(1) + ret(2) + ret(3))
}

export function percentileRank(value: number, peers: number[]): number {
  if (peers.length === 0) return 0
  const below = peers.filter((p) => p < value).length
  const equal = peers.filter((p) => p === value).length
  return ((below + equal / 2) / peers.length) * 100
}

export interface Criterion {
  id: number
  label: string
  ok: boolean
  value: string
}

export interface TrendTemplate {
  criteria: Criterion[]
  passedCount: number
  total: number
  passed: boolean
  stage2: boolean
}

const fmt = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 2 })
const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`

export function evaluateTrendTemplate(bars: Bar[], rsPercentile: number | null): TrendTemplate | null {
  if (bars.length < 200 + SLOPE_BARS) return null
  const closes = bars.map((b) => b.close)
  const price = closes[closes.length - 1]
  const sma50 = sma(closes, 50)!
  const sma150 = sma(closes, 150)!
  const sma200 = sma(closes, 200)!
  const sma200Before = sma(closes, 200, closes.length - SLOPE_BARS)!
  const year = bars.slice(-WEEK52)
  const high52 = Math.max(...year.map((b) => b.high))
  const low52 = Math.min(...year.map((b) => b.low))

  const criteria: Criterion[] = [
    { id: 1, label: 'Prezzo sopra le medie a 150 e 200 giorni', ok: price > sma150 && price > sma200, value: `${fmt(price)} vs ${fmt(sma150)} / ${fmt(sma200)}` },
    { id: 2, label: 'Media a 150 giorni sopra quella a 200', ok: sma150 > sma200, value: `${fmt(sma150)} vs ${fmt(sma200)}` },
    { id: 3, label: 'Media a 200 giorni in salita da almeno un mese', ok: sma200 > sma200Before, value: `${fmt(sma200Before)} → ${fmt(sma200)}` },
    { id: 4, label: 'Media a 50 giorni sopra quelle a 150 e 200', ok: sma50 > sma150 && sma50 > sma200, value: `${fmt(sma50)} vs ${fmt(sma150)} / ${fmt(sma200)}` },
    { id: 5, label: 'Prezzo sopra la media a 50 giorni', ok: price > sma50, value: `${fmt(price)} vs ${fmt(sma50)}` },
    { id: 6, label: 'Almeno 30% sopra il minimo a 52 settimane', ok: price >= low52 * 1.3, value: pct(price / low52 - 1) },
    { id: 7, label: 'Entro il 25% dal massimo a 52 settimane', ok: price >= high52 * 0.75, value: pct(price / high52 - 1) },
    {
      id: 8,
      label: 'Forza relativa almeno 70',
      ok: rsPercentile !== null && rsPercentile >= 70,
      value: rsPercentile === null ? 'non affidabile' : String(Math.round(rsPercentile)),
    },
  ]
  const counted = rsPercentile === null ? criteria.slice(0, 7) : criteria
  const passedCount = counted.filter((c) => c.ok).length
  return {
    criteria,
    passedCount,
    total: counted.length,
    passed: passedCount === counted.length,
    stage2: criteria.slice(0, 5).every((c) => c.ok),
  }
}
