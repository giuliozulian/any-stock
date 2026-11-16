import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { buildAnalysis } from '@/lib/minervini-data'

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
