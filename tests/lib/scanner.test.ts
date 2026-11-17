import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { RS_MIN_BARS, TREND_TEMPLATE_LABELS } from '@/lib/minervini'
import { finalize, isEntrySetup, missingCriterion, scanSymbol, tradePlan, type FinalizeInput } from '@/lib/scanner'

const DAY = 86_400_000
const bar = (i: number, close: number): Bar => ({ t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 })
const series = (n: number, f: (i: number) => number): Bar[] => Array.from({ length: n }, (_, i) => bar(i, f(i)))

describe('scanSymbol', () => {
  it('returns null below the minimum history', () => {
    expect(scanSymbol(series(RS_MIN_BARS - 1, (i) => 100 + i))).toBeNull()
    expect(scanSymbol([])).toBeNull()
  })

  it('evaluates a steady uptrend: seven criteria, all passed', () => {
    const bars = series(300, (i) => 100 + i * 0.5)
    const r = scanSymbol(bars)!
    expect(r.criteria).toHaveLength(7)
    expect(r.criteria.every((c) => c.ok)).toBe(true)
    expect(r.price).toBeCloseTo(bars[299].close, 6)
    expect(r.barDate).toEqual(new Date(bars[299].t))
    expect(r.weightedReturn).toBeGreaterThan(0)
  })

  it('fails the trend criteria on a downtrend', () => {
    const r = scanSymbol(series(300, (i) => 300 - i * 0.5))!
    expect(r.criteria.some((c) => !c.ok)).toBe(true)
    expect(r.weightedReturn).toBeLessThan(0)
  })

  it('reports the volume of the last bar against its 50-bar average', () => {
    const bars = series(300, (i) => 100 + i * 0.5)
    expect(scanSymbol(bars)!.volumeRatio).toBeCloseTo(1, 6)
    const loud = bars.map((b, i) => (i === 299 ? { ...b, volume: 2_000_000 } : b))
    expect(scanSymbol(loud)!.volumeRatio).toBeGreaterThan(1.4)
  })

  it('reports the distance from the pivot when a base exists', () => {
    const r = scanSymbol(series(300, (i) => 100 + i * 0.5))!
    if (r.pivot !== null) expect(r.pivotDistancePct).toBeCloseTo((r.price / r.pivot - 1) * 100, 6)
    else expect(r.pivotDistancePct).toBeNull()
  })
})

const row = (symbol: string, weightedReturn: number, okCount = 7): FinalizeInput => ({
  symbol,
  weightedReturn,
  criteria: Array.from({ length: 7 }, (_, i) => ({ id: i + 1, label: TREND_TEMPLATE_LABELS[i], ok: i < okCount, value: '', margin: null })),
})

describe('finalize', () => {
  it('ranks each row against all the other rows, so the best reaches 100', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`S${i}`, i / 10))
    const out = new Map(finalize(rows).map((o) => [o.symbol, o]))
    expect(out.get('S9')!.rs).toBeCloseTo(100, 6)
    expect(out.get('S0')!.rs).toBeCloseTo(0, 6)
  })

  it('adds the RS criterion only at 70 or more', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`S${i}`, i / 10))
    const out = new Map(finalize(rows).map((o) => [o.symbol, o]))
    // S9 is above everyone: 7 trend criteria + RS = 8. S0 is below everyone: 7 + nothing = 7.
    expect(out.get('S9')!.passedCount).toBe(8)
    expect(out.get('S0')!.passedCount).toBe(7)
  })

  it('counts only the criteria that passed', () => {
    const rows = [row('A', 1, 4), ...Array.from({ length: 9 }, (_, i) => row(`S${i}`, i / 10))]
    expect(finalize(rows).find((o) => o.symbol === 'A')!.passedCount).toBe(5)
  })

  it('leaves rs null and never divides by zero with too few rows', () => {
    expect(finalize([])).toEqual([])
    const one = finalize([row('A', 0.5)])
    expect(one).toEqual([{ symbol: 'A', rs: null, passedCount: 7 }])
    const four = finalize(Array.from({ length: 4 }, (_, i) => row(`S${i}`, i)))
    expect(four.every((o) => o.rs === null)).toBe(true)
  })
})

describe('missingCriterion', () => {
  it('names the failed trend criterion', () => {
    const criteria = row('A', 0, 7).criteria.map((c) => (c.id === 5 ? { ...c, ok: false } : c))
    expect(missingCriterion(criteria, 90)).toBe(TREND_TEMPLATE_LABELS[4])
  })

  it('names the RS criterion when only RS is missing', () => {
    expect(missingCriterion(row('A', 0, 7).criteria, 55)).toBe(TREND_TEMPLATE_LABELS[7])
  })

  it('returns null when nothing is missing', () => {
    expect(missingCriterion(row('A', 0, 7).criteria, 90)).toBeNull()
  })
})

describe('isEntrySetup', () => {
  const ok = { passedCount: 8, vcpStatus: 'breakout' as const, volumeRatio: 1.6 }

  it('is true for a stock passing all 8 criteria that is breaking out on strong volume', () => {
    expect(isEntrySetup(ok)).toBe(true)
    expect(isEntrySetup({ ...ok, volumeRatio: 1.4 })).toBe(true)
  })

  it('is false when any condition is missing', () => {
    expect(isEntrySetup({ ...ok, passedCount: 7 })).toBe(false)
    expect(isEntrySetup({ ...ok, vcpStatus: 'forming' })).toBe(false)
    expect(isEntrySetup({ ...ok, vcpStatus: 'extended' })).toBe(false)
    expect(isEntrySetup({ ...ok, vcpStatus: null })).toBe(false)
    expect(isEntrySetup({ ...ok, volumeRatio: 1.39 })).toBe(false)
    expect(isEntrySetup({ ...ok, volumeRatio: null })).toBe(false)
  })
})

describe('tradePlan', () => {
  const base = { passedCount: 8, vcpStatus: 'breakout' as const, volumeRatio: 1.8, price: 102, pivot: 100 }

  it('says buy on a breakout with strong volume, with the buy range, the stop and the profit zone', () => {
    const p = tradePlan(base)
    expect(p.verdict).toBe('buy')
    expect(p.buyFrom).toBeCloseTo(100, 6)
    expect(p.buyTo).toBeCloseTo(105, 6)
    expect(p.stop).toBeCloseTo(92, 6)
    expect(p.riskPct).toBeCloseTo(((102 - 92) / 102) * 100, 6)
    expect(p.profitFrom).toBeCloseTo(102 * 1.2, 6)
    expect(p.profitTo).toBeCloseTo(102 * 1.25, 6)
  })

  it('asks for confirmation on a breakout with weak or unknown volume', () => {
    expect(tradePlan({ ...base, volumeRatio: 1.1 }).verdict).toBe('confirm')
    expect(tradePlan({ ...base, volumeRatio: null }).verdict).toBe('confirm')
    expect(tradePlan({ ...base, volumeRatio: 1.1 }).stop).toBeCloseTo(92, 6)
  })

  it('says watch while the price is still below the pivot, measuring risk from the pivot', () => {
    const p = tradePlan({ ...base, vcpStatus: 'forming', price: 96 })
    expect(p.verdict).toBe('watch')
    expect(p.buyFrom).toBeCloseTo(100, 6)
    expect(p.stop).toBeCloseTo(92, 6)
    expect(p.riskPct).toBeCloseTo(8, 6)
    expect(p.profitFrom).toBeCloseTo(120, 6)
  })

  it('gives no prices when it is too late, the base is broken, or there is no base', () => {
    for (const [vcpStatus, verdict] of [['extended', 'late'], ['failed', 'broken'], [null, 'no-base']] as const) {
      const p = tradePlan({ ...base, vcpStatus, pivot: vcpStatus === null ? null : 100 })
      expect(p.verdict).toBe(verdict)
      expect([p.buyFrom, p.buyTo, p.stop, p.riskPct, p.profitFrom, p.profitTo]).toEqual([null, null, null, null, null, null])
    }
  })

  it('says almost for a stock that misses a criterion, whatever its base looks like', () => {
    const p = tradePlan({ ...base, passedCount: 7 })
    expect(p.verdict).toBe('almost')
    expect(p.buyFrom).toBeNull()
  })

  it('treats a base without a pivot as no base', () => {
    expect(tradePlan({ ...base, vcpStatus: 'forming', pivot: null }).verdict).toBe('no-base')
  })
})
