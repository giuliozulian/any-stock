import { describe, expect, it } from 'vitest'
import { marketReturnSince } from '@/lib/congress-benchmark'

const bar = (date: string, close: number) => ({ t: Date.parse(`${date}T15:00:00Z`), high: close, low: close, close, volume: 1 })
const bars = [bar('2026-11-02', 100), bar('2026-11-03', 102), bar('2026-11-04', 110)]

describe('marketReturnSince', () => {
  it('measures from the first session on or after the date to the latest close', () => {
    expect(marketReturnSince(bars, '2026-11-02')).toBeCloseTo(10)
    expect(marketReturnSince(bars, '2026-11-03')).toBeCloseTo((110 / 102 - 1) * 100)
    // A weekend purchase counts from the next session.
    expect(marketReturnSince([bar('2026-11-02', 100), bar('2026-11-05', 105), bar('2026-11-06', 110)], '2026-11-03')).toBeCloseTo((110 / 105 - 1) * 100)
  })
  it('is null when the series does not cover the date', () => {
    expect(marketReturnSince(bars, '2026-10-01')).toBeNull()
    expect(marketReturnSince(bars, '2026-12-01')).toBeNull()
    expect(marketReturnSince([], '2026-11-02')).toBeNull()
  })
})
