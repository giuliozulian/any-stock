import { describe, it, expect } from 'vitest'
import { barDay, dueHorizons, measureReturns, resultOf } from '@/lib/verdict-backtest'
import { weekdayBars } from '../helpers/bars'

const rising = (from: number, n: number, step = 1) => Array.from({ length: n }, (_, i) => from + i * step)
// Benchmark closing 1% above its reference after 10 trading days.
const bench = (n: number) => rising(4000, n, 4)

describe('resultOf', () => {
  it('judges a positive verdict by a rise of at least 2%', () => {
    expect(resultOf('positive', 2)).toBe('win')
    expect(resultOf('positive', 1.99)).toBe('neutral')
    expect(resultOf('positive', -1.99)).toBe('neutral')
    expect(resultOf('positive', -2)).toBe('loss')
  })

  it('judges a negative verdict by a fall of at least 2%', () => {
    expect(resultOf('negative', -2)).toBe('win')
    expect(resultOf('negative', 0)).toBe('neutral')
    expect(resultOf('negative', 2)).toBe('loss')
  })

  it('has no result for a neutral verdict or a missing signal', () => {
    expect(resultOf('neutral', 10)).toBeNull()
    expect(resultOf('unknown', 10)).toBeNull()
  })
})

describe('measureReturns', () => {
  const verdict = { refDate: '2026-11-02', refPrice: 100 }

  it('measures stock and benchmark over the horizon and takes the difference', () => {
    const r = measureReturns(verdict, 10, weekdayBars('2026-11-02', rising(100, 12)), weekdayBars('2026-11-02', bench(12)))
    expect(r).not.toBeNull()
    expect(r!.evalDate).toBe('2026-11-16')
    expect(r!.stockReturnPct).toBeCloseTo(10, 6)
    expect(r!.benchReturnPct).toBeCloseTo(1, 6)
    expect(r!.excessPct).toBeCloseTo(9, 6)
  })

  it('counts trading days, so a holiday without a bar pushes the evaluation day out', () => {
    const stock = weekdayBars('2026-11-02', rising(100, 13)).filter((b) => barDay(b.t) !== '2026-11-11')
    const r = measureReturns(verdict, 10, stock, weekdayBars('2026-11-02', bench(13)))
    expect(r!.evalDate).toBe('2026-11-17')
  })

  it('is not matured while the horizon bar does not exist', () => {
    expect(measureReturns(verdict, 10, weekdayBars('2026-11-02', rising(100, 10)), weekdayBars('2026-11-02', bench(12)))).toBeNull()
  })

  it('is not measured when the benchmark has not reached the evaluation day', () => {
    expect(measureReturns(verdict, 10, weekdayBars('2026-11-02', rising(100, 12)), weekdayBars('2026-11-02', bench(6)))).toBeNull()
  })

  it('is not measured when the reference day has no bar or the reference price is not positive', () => {
    const stock = weekdayBars('2026-11-02', rising(100, 12))
    const benchBars = weekdayBars('2026-11-02', bench(12))
    expect(measureReturns({ refDate: '2026-11-01', refPrice: 100 }, 10, stock, benchBars)).toBeNull()
    expect(measureReturns({ refDate: '2026-11-04', refPrice: 100 }, 10, stock, benchBars)).toBeNull()
    expect(measureReturns({ refDate: '2026-11-02', refPrice: 0 }, 10, stock, benchBars)).toBeNull()
  })

  it('aligns by UTC day when the two series are stamped at different hours of the day', () => {
    const tokyo = weekdayBars('2026-11-02', rising(100, 12)).map((b) => ({ ...b, t: Date.parse(`${barDay(b.t)}T00:00:00Z`) }))
    const r = measureReturns(verdict, 10, tokyo, weekdayBars('2026-11-02', bench(12)))
    expect(r!.evalDate).toBe('2026-11-16')
    expect(r!.excessPct).toBeCloseTo(9, 6)
  })

  it('reports a benchmark that rose as much as the stock as no excess, and more as a negative one', () => {
    const r = measureReturns(verdict, 10, weekdayBars('2026-11-02', rising(100, 12)), weekdayBars('2026-11-02', rising(4000, 12, 40)))
    expect(r!.stockReturnPct).toBeCloseTo(10, 6)
    expect(r!.benchReturnPct).toBeCloseTo(10, 6)
    expect(r!.excessPct).toBeCloseTo(0, 6)
    const worse = measureReturns(verdict, 10, weekdayBars('2026-11-02', rising(100, 12)), weekdayBars('2026-11-02', rising(4000, 12, 80)))
    expect(worse!.excessPct).toBeLessThan(0)
  })
})

describe('dueHorizons', () => {
  it('returns the horizons whose minimum calendar span has passed and that are not done', () => {
    expect(dueHorizons('2026-11-02', [], '2026-11-15')).toEqual([])
    expect(dueHorizons('2026-11-02', [], '2026-11-16')).toEqual([10])
    expect(dueHorizons('2026-11-02', [10], '2026-12-14')).toEqual([30])
    expect(dueHorizons('2026-11-02', [], '2027-03-10')).toEqual([10, 30, 90])
  })
})
