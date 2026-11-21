import type { Tone } from './evaluate'
import { resultOf, type Result } from './verdict-backtest'

// Below this many matured verdicts a success rate says little; the admin view warns.
export const MIN_SAMPLE = 30

export const SIGNALS = ['overall', 'shortTerm', 'mediumTerm', 'longTerm', 'fairValue', 'news'] as const
export type SignalKey = (typeof SIGNALS)[number]

export interface StatRow {
  horizon: number
  tones: Record<SignalKey, Tone>
  stockReturnPct: number
  excessPct: number
}

export interface Counts {
  win: number
  loss: number
  neutral: number
  // Wins over wins plus losses, in percent. Null when there is neither.
  rate: number | null
}

export interface ToneStats {
  count: number
  avgReturnPct: number | null
  avgExcessPct: number | null
}

export interface SignalStats {
  matured: number
  abs: Counts
  rel: Counts
  byTone: Record<'positive' | 'neutral' | 'negative', ToneStats>
}

const TONES: Tone[] = ['positive', 'neutral', 'negative', 'unknown']
export const toTone = (s: string): Tone => TONES.find((t) => t === s) ?? 'unknown'

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length)

function counts(results: Array<Result | null>): Counts {
  const win = results.filter((r) => r === 'win').length
  const loss = results.filter((r) => r === 'loss').length
  const neutral = results.filter((r) => r === 'neutral').length
  return { win, loss, neutral, rate: win + loss === 0 ? null : (win / (win + loss)) * 100 }
}

// Rows are those of one horizon and one rules version: the caller filters them.
export function summarize(rows: StatRow[], key: SignalKey): SignalStats {
  const known = rows.filter((r) => r.tones[key] !== 'unknown')
  const group = (tone: 'positive' | 'neutral' | 'negative'): ToneStats => {
    const g = known.filter((r) => r.tones[key] === tone)
    return { count: g.length, avgReturnPct: mean(g.map((r) => r.stockReturnPct)), avgExcessPct: mean(g.map((r) => r.excessPct)) }
  }
  return {
    matured: known.length,
    abs: counts(known.map((r) => resultOf(r.tones[key], r.stockReturnPct))),
    rel: counts(known.map((r) => resultOf(r.tones[key], r.excessPct))),
    byTone: { positive: group('positive'), neutral: group('neutral'), negative: group('negative') },
  }
}
