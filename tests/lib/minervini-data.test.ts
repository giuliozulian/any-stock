import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { buildAnalysis, toAnalysisFundamentals } from '@/lib/minervini-data'

const bars: Bar[] = Array.from({ length: 300 }, (_, i) => {
  const c = 50 + i * 0.5
  return { t: i * 86_400_000, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 }
})

describe('buildAnalysis', () => {
  it('ranks the stock against peers and counts all 8 criteria', () => {
    const a = buildAnalysis(bars, [-0.2, -0.1, 0, 0.05, 0.1, 0.15])!
    expect(a.peerCount).toBe(6)
    expect(a.template.total).toBe(8)
  })

  it('marks RS unreliable with fewer than 5 peers', () => {
    const a = buildAnalysis(bars, [0.1, 0.2])!
    expect(a.template.total).toBe(7)
  })

  it('returns null without enough history', () => {
    expect(buildAnalysis(bars.slice(0, 100), [])).toBeNull()
  })
})

describe('buildAnalysis fundamentals and VWAP', () => {
  const eg = { epsGrowthQoq: 0.18, salesGrowthQoq: -13.85, roe: 12.51 }

  it('carries the fundamentals it is given, and none by default', () => {
    expect(buildAnalysis(bars, [], eg)!.fundamentals).toEqual(eg)
    expect(buildAnalysis(bars, [])!.fundamentals).toBeNull()
  })

  it('carries the anchored VWAP of the base', () => {
    const a = buildAnalysis(bars, [])!
    expect(a.avwap).toBe(a.vcp.avwap)
  })
})

describe('toAnalysisFundamentals', () => {
  it('is null when Finnhub failed, and maps the fields otherwise', () => {
    expect(toAnalysisFundamentals(null)).toBeNull()
    expect(toAnalysisFundamentals({ roe: 12.5, epsGrowthQuarterlyYoy: 0.18, revenueGrowthQuarterlyYoy: -13.85 } as never)).toEqual({ epsGrowthQoq: 0.18, salesGrowthQoq: -13.85, roe: 12.5 })
  })
})
