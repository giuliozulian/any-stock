import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { detectVcp, evaluateTrendTemplate, percentileRank, sma, weightedReturn } from '@/lib/minervini'

const bar = (i: number, close: number): Bar => ({ t: i * 86_400_000, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 })
const series = (n: number, f: (i: number) => number): Bar[] => Array.from({ length: n }, (_, i) => bar(i, f(i)))

// Piecewise-linear closes through the given turning points, `leg` bars per leg.
const path = (points: number[], leg = 10, volume = 1_000_000): Bar[] => {
  const closes: number[] = [points[0]]
  for (let k = 1; k < points.length; k++) {
    for (let s = 1; s <= leg; s++) closes.push(points[k - 1] + ((points[k] - points[k - 1]) * s) / leg)
  }
  return closes.map((c, i) => ({ t: i * 86_400_000, high: c, low: c, close: c, volume }))
}

describe('detectVcp', () => {
  // 25% → 12% → 6% pullbacks, each rally failing to exceed the previous peak by much.
  const base = path([80, 100, 75, 95, 83.6, 94, 88.36, 93])

  it('finds progressively smaller contractions and the pivot', () => {
    const v = detectVcp(base)
    expect(v.contractions).toHaveLength(3)
    expect(v.contractions[0]).toBeCloseTo(0.25, 2)
    expect(v.contractions[1]).toBeCloseTo(0.12, 2)
    expect(v.contractions[2]).toBeCloseTo(0.06, 2)
    expect(v.pivot).toBeCloseTo(94, 1)
    expect(v.suggestedStop).toBeCloseTo(94 * 0.92, 1)
    expect(v.lastLow).toBeCloseTo(88.36, 1)
    expect(v.status).toBe('forming')
  })

  it('tells a breakout from an extended move and a failed base', () => {
    expect(detectVcp(path([80, 100, 75, 95, 83.6, 94, 88.36, 96])).status).toBe('breakout')
    expect(detectVcp(path([80, 100, 75, 95, 83.6, 94, 88.36, 104])).status).toBe('extended')
  })

  it('compares the last volume with its 50-bar average', () => {
    const loud = base.map((b, i) => ({ ...b, volume: i === base.length - 1 ? 2_000_000 : 1_000_000 }))
    expect(detectVcp(loud).volumeRatio).toBeGreaterThan(1.4)
  })

  it('does not flag a base whose pullbacks grow', () => {
    const v = detectVcp(path([80, 100, 94, 99, 80, 95]))
    expect(v.contractions).toEqual([])
    expect(v.pivot).toBeNull()
    expect(v.suggestedStop).toBeNull()
  })

  it('flags volume dry-up when recent volume is below the 50-bar average', () => {
    const quiet = base.map((b, i) => ({ ...b, volume: i >= base.length - 10 ? 300_000 : 1_000_000 }))
    expect(detectVcp(quiet).volumeDryUp).toBe(true)
    expect(detectVcp(base).volumeDryUp).toBe(false)
  })
})

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

  it('describes distances in plain words and how long the 200-day average has risen', () => {
    const t = evaluateTrendTemplate(uptrend, 85)!
    expect(t.criteria.find((c) => c.id === 1)!.value).toMatch(/% sopra$/)
    expect(t.criteria.find((c) => c.id === 3)!.value).toBe('in salita da 4 mesi')
    expect(t.criteria.find((c) => c.id === 1)!.margin).toBeGreaterThan(0)
    expect(t.levels.map((l) => l.key)).toEqual(['price', 'sma50', 'sma150', 'sma200'])
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
