import { describe, it, expect } from 'vitest'
import { bigMovers } from '@/lib/market'

describe('bigMovers', () => {
  it('keeps only moves of at least 15% either way, largest first', () => {
    const items = [
      { symbol: 'A', name: 'A', changePct: 5 },
      { symbol: 'B', name: 'B', changePct: -16 },
      { symbol: 'C', name: 'C', changePct: 15 },
      { symbol: 'D', name: 'D', changePct: 22 },
      { symbol: 'E', name: 'E', changePct: -14.9 },
    ]
    expect(bigMovers(items).map((i) => i.symbol)).toEqual(['D', 'B', 'C'])
  })
})
