import { describe, expect, it } from 'vitest'
import { loadUniverse, toYahooSymbol } from '@/lib/universe'

describe('toYahooSymbol', () => {
  it('turns class-share dots into dashes', () => {
    expect(toYahooSymbol('BRK.B')).toBe('BRK-B')
    expect(toYahooSymbol('BF.B')).toBe('BF-B')
    expect(toYahooSymbol('AAPL')).toBe('AAPL')
  })
})

describe('loadUniverse', () => {
  const universe = loadUniverse()

  it('lists about five hundred companies', () => {
    expect(universe.length).toBeGreaterThan(450)
    expect(universe.length).toBeLessThan(520)
  })

  it('has unique, non-empty symbols and keeps the original dotted form', () => {
    const symbols = universe.map((e) => e.symbol)
    expect(new Set(symbols).size).toBe(symbols.length)
    expect(symbols.every((s) => /^[A-Z.]+$/.test(s))).toBe(true)
    expect(symbols).toContain('BRK.B')
  })

  it('gives every entry a name', () => {
    expect(universe.every((e) => e.name.length > 0)).toBe(true)
  })
})
