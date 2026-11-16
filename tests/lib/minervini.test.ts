import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { evaluateTrendTemplate, percentileRank, sma, weightedReturn } from '@/lib/minervini'

const bar = (i: number, close: number): Bar => ({ t: i * 86_400_000, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 })
const series = (n: number, f: (i: number) => number): Bar[] => Array.from({ length: n }, (_, i) => bar(i, f(i)))

describe('sma', () => {
  it('averages the last n values, optionally ending before an index', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4)
    expect(sma([1, 2, 3, 4, 5], 3, 4)).toBe(3)
  })
  it('returns null when there are not enough values', () => {
    expect(sma([1, 2], 3)).toBeNull()
  })
})

describe('weightedReturn', () => {
  it('weights the last quarter 40% and the three before 20% each', () => {
    const closes = Array.from({ length: 253 }, (_, i) => 100 * Math.pow(1.001, i))
    const q = Math.pow(1.001, 63) - 1
    expect(weightedReturn(closes)).toBeCloseTo(q, 3)
  })
  it('needs 253 closes', () => {
    expect(weightedReturn(Array(252).fill(100))).toBeNull()
  })
})

describe('percentileRank', () => {
  it('ranks a value among its peers', () => {
    expect(percentileRank(5, [1, 2, 3, 4, 6, 7, 8, 9, 10, 11])).toBe(40)
    expect(percentileRank(2, [2, 2])).toBe(50)
  })
})

describe('evaluateTrendTemplate', () => {
  const uptrend = series(300, (i) => 50 + i * 0.5)

  it('passes all 8 criteria on a steady uptrend with strong RS', () => {
    const t = evaluateTrendTemplate(uptrend, 85)!
    expect(t.criteria).toHaveLength(8)
    expect(t.total).toBe(8)
    expect(t.passedCount).toBe(8)
    expect(t.passed).toBe(true)
    expect(t.stage2).toBe(true)
  })

  it('fails on a downtrend', () => {
    const t = evaluateTrendTemplate(series(300, (i) => 200 - i * 0.4), 85)!
    expect(t.passed).toBe(false)
    expect(t.stage2).toBe(false)
    expect(t.criteria.find((c) => c.id === 1)!.ok).toBe(false)
  })

  it('fails criterion 8 when RS is below 70', () => {
    const t = evaluateTrendTemplate(uptrend, 40)!
    expect(t.criteria.find((c) => c.id === 8)!.ok).toBe(false)
    expect(t.passed).toBe(false)
    expect(t.stage2).toBe(true)
  })

  it('leaves criterion 8 out of the count when RS is unreliable', () => {
    const t = evaluateTrendTemplate(uptrend, null)!
    expect(t.total).toBe(7)
    expect(t.passedCount).toBe(7)
    expect(t.passed).toBe(true)
    expect(t.criteria.find((c) => c.id === 8)!.value).toBe('non affidabile')
  })

  it('returns null with fewer than 222 bars', () => {
    expect(evaluateTrendTemplate(series(221, (i) => 100 + i), 80)).toBeNull()
  })
})
