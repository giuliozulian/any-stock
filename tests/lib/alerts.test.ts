import { describe, it, expect } from 'vitest'
import { checkTargets, validateTargets } from '@/lib/alerts'

const base = { entryPrice: null, sellPrice: null, entryTriggeredAt: null, sellTriggeredAt: null }

describe('checkTargets', () => {
  it('fires entry at or below the entry price and sell at or above the sell price', () => {
    const t = { ...base, entryPrice: 100, sellPrice: 150 }
    expect(checkTargets(t, 100)).toEqual(['entry'])
    expect(checkTargets(t, 150)).toEqual(['sell'])
    expect(checkTargets(t, 120)).toEqual([])
  })

  it('does not fire again once triggered, or when the target is not set', () => {
    expect(checkTargets({ ...base, entryPrice: 100, entryTriggeredAt: new Date() }, 90)).toEqual([])
    expect(checkTargets(base, 1)).toEqual([])
  })
})

describe('validateTargets', () => {
  it('rejects non-positive values and entry >= sell', () => {
    expect(validateTargets(0, null)).toBeTruthy()
    expect(validateTargets(NaN, null)).toBeTruthy()
    expect(validateTargets(200, 150)).toBeTruthy()
    expect(validateTargets(100, 150)).toBeNull()
    expect(validateTargets(null, null)).toBeNull()
  })
})
