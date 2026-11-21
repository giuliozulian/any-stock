import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { RS_MIN, RS_MIN_BARS, TREND_TEMPLATE_LABELS, VCP_STATUS_LABEL, anchoredVwap, describeBase, detectVcp, evaluateTrendTemplate, percentileRank, riskReward, sma, weightedReturn } from '@/lib/minervini'

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

  it('anchors the stop 8% below the price actually paid: the pivot while below it, the current price once it breaks out', () => {
    expect(detectVcp(base).suggestedStop).toBeCloseTo(94 * 0.92, 4)
    const broke = detectVcp(path([80, 100, 75, 95, 83.6, 94, 88.36, 98]))
    expect(broke.status).toBe('breakout')
    // 98 is 4.3% above the 94 pivot: a stop at 86.48 would risk 11.8%, not 8%.
    expect(broke.suggestedStop).toBeCloseTo(98 * 0.92, 4)
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

describe('detectVcp strictness', () => {
  const base = path([80, 100, 75, 95, 83.6, 94, 88.36, 93])

  it('rejects a base whose last pullback is wider than 7%', () => {
    const loose = detectVcp(path([80, 100, 70, 95, 80, 98, 85, 90]))
    expect(loose.contractions).toEqual([])
    expect(loose.status).toBeNull()
    // 30% → 15.8% → 8.7%: still shrinking, but the final pullback is too loose to be a tight base.
    const almost = detectVcp(path([80, 100, 70, 95, 80, 98, 89.5, 94.5]))
    expect(almost.contractions).toEqual([])
    expect(almost.status).toBeNull()
  })

  it('accepts a base whose last pullback is at most 7%', () => {
    const tight = detectVcp(path([80, 100, 70, 95, 80, 98, 91.5, 96.5]))
    expect(tight.contractions).toHaveLength(3)
    expect(tight.contractions[2]).toBeCloseTo(0.066, 2)
  })

  it('moves the pivot up to a wick that was rejected, so a close just above the old peak is not a breakout', () => {
    const bars = path([80, 100, 75, 95, 83.6, 94, 88.36, 96])
    bars[bars.length - 5] = { ...bars[bars.length - 5], high: 97 }
    const v = detectVcp(bars)
    expect(v.pivot).toBeCloseTo(97, 4)
    expect(v.status).toBe('forming')
  })

  it('keeps the close-based pivot when the rally already closed above it', () => {
    const v = detectVcp(path([80, 100, 75, 95, 83.6, 94, 88.36, 96]))
    expect(v.pivot).toBeCloseTo(94, 1)
    expect(v.status).toBe('breakout')
  })

  it('ignores the breakout day when judging base volume', () => {
    const quietBase = path([80, 100, 75, 95, 83.6, 94, 88.36, 96]).map((b, i, a) => ({ ...b, volume: i === a.length - 1 ? 3_000_000 : i >= a.length - 11 ? 300_000 : 1_000_000 }))
    expect(detectVcp(quietBase).volumeDryUp).toBe(true)
  })

  it('denies a clean base when three or more heavy down days sit in the last 20 sessions', () => {
    const n = base.length
    const noisy = base.map((b, i) => ({ ...b, volume: i >= n - 10 ? 300_000 : i >= n - 20 && i < n - 17 ? 3_000_000 : 1_000_000 }))
    expect(detectVcp(noisy).volumeDryUp).toBe(false)
    const twoOnly = base.map((b, i) => ({ ...b, volume: i >= n - 10 ? 300_000 : i >= n - 20 && i < n - 18 ? 3_000_000 : 1_000_000 }))
    expect(detectVcp(twoOnly).volumeDryUp).toBe(true)
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

describe('shared constants', () => {
  it('exposes the RS threshold and the minimum history for the weighted return', () => {
    expect(RS_MIN).toBe(70)
    expect(RS_MIN_BARS).toBe(253)
    expect(weightedReturn(Array.from({ length: RS_MIN_BARS - 1 }, () => 100))).toBeNull()
    expect(weightedReturn(Array.from({ length: RS_MIN_BARS }, () => 100))).not.toBeNull()
  })

  it('uses the exported labels for the eight criteria, in order', () => {
    const template = evaluateTrendTemplate(series(300, (i) => 100 + i), 80)!
    expect(TREND_TEMPLATE_LABELS).toHaveLength(8)
    expect(template.criteria.map((c) => c.label)).toEqual([...TREND_TEMPLATE_LABELS])
  })

  it('labels every VCP status', () => {
    expect(VCP_STATUS_LABEL).toEqual({ forming: 'Base pronta', breakout: 'In rottura', extended: 'Troppo tardi', failed: 'Base rotta' })
  })
})

describe('describeBase', () => {
  it('measures weeks, depth and whether each pullback is about half the previous', () => {
    const m = describeBase([0.25, 0.12, 0.06], 60, 0.02)
    expect(m.weeks).toBe(12)
    expect(m.depth).toBe(0.25)
    expect(m.tightness).toBe(0.02)
    expect(m.ratios[0]).toBeCloseTo(0.48, 2)
    expect(m.ratios[1]).toBeCloseTo(0.5, 2)
    expect(m).toMatchObject({ halves: true, weeksOk: true, depthOk: true })
  })

  it('flags a pullback that barely shrinks from the previous one', () => {
    expect(describeBase([0.2, 0.18, 0.06], 60, 0.02).halves).toBe(false)
  })

  it('accepts bases of 5 to 26 weeks only', () => {
    expect(describeBase([0.2, 0.1], 20, 0.02).weeksOk).toBe(false)
    expect(describeBase([0.2, 0.1], 25, 0.02).weeksOk).toBe(true)
    expect(describeBase([0.2, 0.1], 130, 0.02).weeksOk).toBe(true)
    expect(describeBase([0.2, 0.1], 135, 0.02).weeksOk).toBe(false)
  })

  it('rejects a base deeper than 50%', () => {
    expect(describeBase([0.5, 0.2], 60, 0.02).depthOk).toBe(true)
    expect(describeBase([0.55, 0.2], 60, 0.02).depthOk).toBe(false)
  })
})

describe('detectVcp base metrics', () => {
  it('reports the base length, depth and the tightness of the last sessions', () => {
    const v = detectVcp(path([80, 100, 75, 95, 83.6, 94, 88.36, 93]))
    expect(v.base?.weeks).toBe(12)
    expect(v.base?.depth).toBeCloseTo(0.25, 2)
    expect(v.base?.tightness).toBeCloseTo(0.02, 3)
    expect(v.base?.halves).toBe(true)
  })

  it('has no base metrics when there is no VCP', () => {
    expect(detectVcp(path([80, 100, 94, 99, 80, 95])).base).toBeNull()
  })

  it('does not call a base with barely shrinking pullbacks one that halves', () => {
    expect(detectVcp(path([80, 100, 80, 99, 81.2, 97, 91.2, 96])).base?.halves).toBe(false)
  })
})

describe('riskReward', () => {
  it('divides the gain to the target by the risk to the stop', () => {
    expect(riskReward(100, 92, 120)).toBeCloseTo(2.5, 5)
  })

  it('returns null when the stop is not below the entry or the target not above it', () => {
    expect(riskReward(100, 100, 120)).toBeNull()
    expect(riskReward(100, 92, 100)).toBeNull()
  })
})

describe('anchoredVwap', () => {
  const flat = (close: number, volume: number): Bar => ({ t: 0, high: close, low: close, close, volume })

  it('weights the typical price by volume from the anchor to the last bar', () => {
    const bars = [flat(10, 1), flat(20, 1), flat(30, 2)]
    expect(anchoredVwap(bars, 1)).toBeCloseTo((20 * 1 + 30 * 2) / 3, 6)
    expect(anchoredVwap(bars, 0)).toBeCloseTo((10 + 20 + 60) / 4, 6)
  })

  it('uses (high + low + close) / 3', () => {
    expect(anchoredVwap([{ t: 0, high: 12, low: 6, close: 9, volume: 5 }], 0)).toBeCloseTo(9, 6)
    expect(anchoredVwap([{ t: 0, high: 12, low: 6, close: 12, volume: 5 }], 0)).toBeCloseTo(10, 6)
  })

  it('starts from the first bar when the anchor is before it, and is null without volume', () => {
    expect(anchoredVwap([flat(10, 1), flat(20, 1)], -3)).toBeCloseTo(15, 6)
    expect(anchoredVwap([flat(10, 0)], 0)).toBeNull()
    expect(anchoredVwap([], 0)).toBeNull()
  })
})

describe('detectVcp avwap', () => {
  it('anchors at the lowest low of the base and stays between the base low and the price', () => {
    const v = detectVcp(path([80, 100, 75, 95, 83.6, 94, 88.36, 96]))
    expect(v.status).toBe('breakout')
    expect(v.avwap).not.toBeNull()
    expect(v.avwap!).toBeGreaterThan(75 * 0.99)
    expect(v.avwap!).toBeLessThan(96 * 1.01)
  })

  it('is null when there is no base', () => {
    expect(detectVcp(series(300, (i) => 100 + i * 0.5)).avwap).toBeNull()
  })
})
