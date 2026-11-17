import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { CHART_BARS, buildChartData } from '@/lib/chart-data'

const bars = (n: number, f: (i: number) => number): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ t: Date.UTC(2025, 0, 1) + i * 86_400_000, high: f(i) * 1.01, low: f(i) * 0.99, close: f(i), volume: 1_000 + i }))

describe('buildChartData', () => {
  const data = buildChartData(bars(300, (i) => 100 + i * 0.1))

  it('draws only the last six months, with ISO dates', () => {
    expect(data.candles).toHaveLength(CHART_BARS)
    expect(data.volumes).toHaveLength(CHART_BARS)
    expect(data.candles[0].time).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('computes each average on the full history so the lines start as early as the history allows', () => {
    expect(data.sma50).toHaveLength(CHART_BARS)
    expect(data.sma200).toHaveLength(300 - 199)
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1)
    expect(data.sma50[CHART_BARS - 1].value).toBeCloseTo(closes.slice(-50).reduce((s, v) => s + v, 0) / 50, 6)
  })

  it('leaves the lines short when the history is short', () => {
    expect(buildChartData(bars(60, () => 100)).sma150).toEqual([])
  })

  it('falls back to the previous close when a bar has no open, and uses the open when present', () => {
    const b = bars(3, (i) => 100 + i)
    b[2] = { ...b[2], open: 99 }
    const c = buildChartData(b).candles
    expect(c[1].open).toBe(100)
    expect(c[2].open).toBe(99)
  })

  it('colours volume by the direction of the day', () => {
    const v = buildChartData(bars(5, (i) => (i === 3 ? 90 : 100))).volumes
    expect(v[3].up).toBe(false)
    expect(v[4].up).toBe(true)
  })

  it('carries the pivot and stop of the base detection, null when there is no base', () => {
    expect(data.pivot).toBeNull()
    expect(data.status).toBeNull()
  })
})
