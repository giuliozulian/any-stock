import { describe, expect, it } from 'vitest'
import { parseChartBars } from '@/lib/history'

const body = (q: Record<string, unknown>) => ({ chart: { result: [{ timestamp: [100, 200, 300], indicators: { quote: [q] } }] } })

describe('parseChartBars', () => {
  it('maps OHLC rows to bars in milliseconds, oldest first', () => {
    const bars = parseChartBars(body({ high: [11, 12, 13], low: [9, 10, 11], close: [10, 11, 12], volume: [1000, 2000, 3000] }))
    expect(bars).toEqual([
      { t: 100_000, high: 11, low: 9, close: 10, volume: 1000 },
      { t: 200_000, high: 12, low: 10, close: 11, volume: 2000 },
      { t: 300_000, high: 13, low: 11, close: 12, volume: 3000 },
    ])
  })

  it('drops rows without a valid close/high/low and defaults a missing volume to 0', () => {
    const bars = parseChartBars(body({ high: [11, null, 13], low: [9, 10, 11], close: [10, 11, 12], volume: [null, 2000, 3000] }))
    expect(bars.map((b) => [b.t, b.volume])).toEqual([[100_000, 0], [300_000, 3000]])
  })

  it('returns an empty list for malformed payloads', () => {
    expect(parseChartBars(null)).toEqual([])
    expect(parseChartBars({ chart: { result: null } })).toEqual([])
  })
})
