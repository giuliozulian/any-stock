import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { RS_MIN_BARS, TREND_TEMPLATE_LABELS } from '@/lib/minervini'
import { finalize, isEntrySetup, isUsSession, marketHealth, missingCriterion, scanSymbol, tradePlan, withContext, type FinalizeInput } from '@/lib/scanner'

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

  it('carries the anchored VWAP of the base, null without one', () => {
    const r = scanSymbol(series(300, (i) => 100 + i * 0.5))!
    if (r.pivot === null) expect(r.avwap).toBeNull()
    else expect(r.avwap).toBeGreaterThan(0)
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
    expect(isEntrySetup({ ...ok, volumeRatio: 1.5 })).toBe(true)
    expect(isEntrySetup({ ...ok, volumeDryUp: false })).toBe(false)
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
    // The stop follows the price paid, not the pivot: 8% below 102, so the loss is capped at 8%.
    expect(p.stop).toBeCloseTo(102 * 0.92, 6)
    expect(p.riskPct).toBeCloseTo(8, 6)
    expect(p.profitFrom).toBeCloseTo(102 * 1.2, 6)
    expect(p.profitTo).toBeCloseTo(102 * 1.25, 6)
  })

  it('asks for confirmation on a breakout with weak or unknown volume', () => {
    expect(tradePlan({ ...base, volumeDryUp: false }).verdict).toBe('noisy')
    expect(tradePlan({ ...base, volumeDryUp: true }).verdict).toBe('buy')
    expect(tradePlan({ ...base, volumeRatio: 1.1 }).verdict).toBe('confirm')
    expect(tradePlan({ ...base, volumeRatio: null }).verdict).toBe('confirm')
    expect(tradePlan({ ...base, volumeRatio: 1.1 }).stop).toBeCloseTo(102 * 0.92, 6)
  })

  it('wants 1.5x the average volume: 1.45 is not enough', () => {
    expect(tradePlan({ ...base, volumeRatio: 1.45 }).verdict).toBe('confirm')
    expect(tradePlan({ ...base, volumeRatio: 1.5 }).verdict).toBe('buy')
  })

  describe('fundamentals', () => {
    const eg = { epsGrowthQoq: 0.18, salesGrowthQoq: -13.85, roe: 12.51 }
    const strong = { epsGrowthQoq: 40, salesGrowthQoq: 30, roe: 20 }

    it('turns a buy into "technical ok, weak fundamentals" and keeps the prices of the setup', () => {
      const p = tradePlan({ ...base, fundamentals: eg })
      expect(p.verdict).toBe('weak-fundamentals')
      expect(p.buyFrom).toBeCloseTo(100, 6)
      expect(p.stop).toBeCloseTo(102 * 0.92, 6)
    })

    it('keeps the buy when the fundamentals pass, are partly unknown or are not known at all', () => {
      expect(tradePlan({ ...base, fundamentals: strong }).verdict).toBe('buy')
      expect(tradePlan({ ...base, fundamentals: { epsGrowthQoq: 40, salesGrowthQoq: null, roe: null } }).verdict).toBe('buy')
      expect(tradePlan({ ...base, fundamentals: { epsGrowthQoq: null, salesGrowthQoq: null, roe: null } }).verdict).toBe('buy')
      expect(tradePlan({ ...base, fundamentals: null }).verdict).toBe('buy')
      expect(tradePlan(base).verdict).toBe('buy')
    })

    it('only touches a buy: the other verdicts stay as they are', () => {
      expect(tradePlan({ ...base, fundamentals: eg, volumeRatio: 1.1 }).verdict).toBe('confirm')
      expect(tradePlan({ ...base, fundamentals: eg, vcpStatus: 'forming', price: 96 }).verdict).toBe('watch')
      expect(tradePlan({ ...base, fundamentals: eg, vcpStatus: 'extended', price: 120 }).verdict).toBe('late')
      expect(tradePlan({ ...base, fundamentals: eg, volumeDryUp: false }).verdict).toBe('noisy')
    })
  })

  describe('anchored VWAP', () => {
    it('asks for confirmation when the price is under the VWAP of the base', () => {
      const p = tradePlan({ ...base, avwap: 103 })
      expect(p.verdict).toBe('confirm')
      expect(p.reason).toBe('below-avwap')
      expect(p.stop).toBeCloseTo(102 * 0.92, 6)
    })

    it('keeps the buy at or above the VWAP, or without one', () => {
      expect(tradePlan({ ...base, avwap: 102 }).verdict).toBe('buy')
      expect(tradePlan({ ...base, avwap: 95 }).verdict).toBe('buy')
      expect(tradePlan({ ...base, avwap: null }).verdict).toBe('buy')
      expect(tradePlan({ ...base, avwap: 95 }).reason).toBeNull()
    })

    it('names the weak fundamentals first when both apply', () => {
      expect(tradePlan({ ...base, avwap: 103, fundamentals: { epsGrowthQoq: 1, salesGrowthQoq: 1, roe: 1 } }).verdict).toBe('weak-fundamentals')
    })
  })

  it('says watch while the price is still below the pivot, measuring risk from the pivot', () => {
    const p = tradePlan({ ...base, vcpStatus: 'forming', price: 96 })
    expect(p.verdict).toBe('watch')
    expect(p.buyFrom).toBeCloseTo(100, 6)
    expect(p.stop).toBeCloseTo(92, 6)
    expect(p.riskPct).toBeCloseTo(8, 6)
    expect(p.profitFrom).toBeCloseTo(120, 6)
  })

  it('never risks more than 8% of the price paid, wherever in the 5% buy range it is', () => {
    for (const price of [100.5, 102, 104.9]) {
      const p = tradePlan({ ...base, price })
      expect(((price - p.stop!) / price) * 100).toBeCloseTo(8, 6)
    }
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

describe('isUsSession', () => {
  it('is true on a weekday while the US market can be open, false outside', () => {
    expect(isUsSession(new Date('2026-11-16T15:00:00Z'))).toBe(true) // Monday
    expect(isUsSession(new Date('2026-11-16T13:30:00Z'))).toBe(true)
    expect(isUsSession(new Date('2026-11-16T13:29:00Z'))).toBe(false)
    expect(isUsSession(new Date('2026-11-16T21:00:00Z'))).toBe(false)
    expect(isUsSession(new Date('2026-11-16T22:40:00Z'))).toBe(false)
  })

  it('is false on weekends', () => {
    expect(isUsSession(new Date('2026-11-14T15:00:00Z'))).toBe(false) // Saturday
    expect(isUsSession(new Date('2026-11-15T15:00:00Z'))).toBe(false) // Sunday
  })
})

describe('marketHealth', () => {
  const crit = (ok: boolean) => [{ id: 1, label: 'x', ok, value: '', margin: null }]
  const sample = (above: number, total: number) => Array.from({ length: total }, (_, i) => crit(i < above))

  it('is healthy at 60% or more of stocks above their 150 and 200-day averages', () => {
    expect(marketHealth(sample(60, 100))).toEqual({ abovePct: 60, level: 'healthy' })
  })

  it('is neutral between 40% and 60%, weak below 40%', () => {
    expect(marketHealth(sample(59, 100))!.level).toBe('neutral')
    expect(marketHealth(sample(40, 100))!.level).toBe('neutral')
    expect(marketHealth(sample(39, 100))!.level).toBe('weak')
  })

  it('says nothing on a sample too small to mean anything', () => {
    expect(marketHealth(sample(10, 49))).toBeNull()
    expect(marketHealth([])).toBeNull()
  })
})

describe('withContext', () => {
  const buy = tradePlan({ passedCount: 8, vcpStatus: 'breakout', volumeRatio: 1.8, price: 102, pivot: 100 })
  const watch = tradePlan({ passedCount: 8, vcpStatus: 'forming', volumeRatio: 1, price: 96, pivot: 100 })
  const late = tradePlan({ passedCount: 8, vcpStatus: 'extended', volumeRatio: 1, price: 120, pivot: 100 })
  const none = { caution: null, market: null }

  it('leaves the plan alone in normal conditions', () => {
    expect(withContext(buy, none)).toEqual({ plan: buy, note: null })
    expect(withContext(buy, { caution: null, market: 'healthy' })).toEqual({ plan: buy, note: null })
    expect(withContext(buy, { caution: null, market: 'neutral' })).toEqual({ plan: buy, note: null })
  })

  it('turns buy into "wait for confirmation" when the scan ran with the US market open', () => {
    const r = withContext(buy, { caution: 'session', market: 'healthy' })
    expect(r.plan.verdict).toBe('confirm')
    expect(r.plan.stop).toBe(buy.stop)
    expect(r.note).toBe('session')
  })

  it('turns buy into "wait for confirmation" in a weak market', () => {
    const r = withContext(buy, { caution: null, market: 'weak' })
    expect(r.plan.verdict).toBe('confirm')
    expect(r.note).toBe('weak-market')
  })

  it('names the open-market reason first when both apply', () => {
    expect(withContext(buy, { caution: 'session', market: 'weak' }).note).toBe('session')
  })

  it('explains a downgrade for a price under the VWAP with its own note', () => {
    const under = tradePlan({ passedCount: 8, vcpStatus: 'breakout', volumeRatio: 1.8, price: 102, pivot: 100, avwap: 104 })
    expect(withContext(under, none)).toEqual({ plan: under, note: 'below-avwap' })
    expect(withContext(under, { caution: 'session', market: 'weak' }).note).toBe('below-avwap')
  })

  it('treats weak fundamentals as a verdict with prices, so old results are flagged', () => {
    const weak = tradePlan({ passedCount: 8, vcpStatus: 'breakout', volumeRatio: 1.8, price: 102, pivot: 100, fundamentals: { epsGrowthQoq: 0, salesGrowthQoq: -14, roe: 12 } })
    expect(withContext(weak, { caution: 'stale', market: null })).toEqual({ plan: weak, note: 'stale' })
    expect(withContext(weak, { caution: 'session', market: 'weak' })).toEqual({ plan: weak, note: null })
  })

  it('flags old results without changing the verdict', () => {
    expect(withContext(buy, { caution: 'stale', market: null })).toEqual({ plan: buy, note: 'stale' })
    expect(withContext(watch, { caution: 'stale', market: null }).note).toBe('stale')
  })

  it('does not bother stocks that have no prices anyway', () => {
    expect(withContext(late, { caution: 'stale', market: 'weak' })).toEqual({ plan: late, note: null })
  })

  it('does not change what was already a wait or watch verdict in a weak market', () => {
    expect(withContext(watch, { caution: null, market: 'weak' })).toEqual({ plan: watch, note: null })
  })
})
