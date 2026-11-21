import { describe, expect, it } from 'vitest'
import { fundamentalsMisses, fundamentalsState, type Fundamentals } from '@/lib/fundamentals-gate'

const strong: Fundamentals = { epsGrowthQoq: 40, salesGrowthQoq: 30, roe: 20 }
const eg: Fundamentals = { epsGrowthQoq: 0.18, salesGrowthQoq: -13.85, roe: 12.51 }

describe('fundamentalsState', () => {
  it('passes when every known measure is above its threshold', () => {
    expect(fundamentalsState(strong)).toBe('pass')
  })

  it('fails Everest Group on all three measures', () => {
    expect(fundamentalsState(eg)).toBe('fail')
    expect(fundamentalsMisses(eg)).toHaveLength(3)
  })

  it('fails on the threshold itself, like "over 25%" in Finviz', () => {
    expect(fundamentalsState({ ...strong, epsGrowthQoq: 25 })).toBe('fail')
    expect(fundamentalsState({ ...strong, roe: 15 })).toBe('fail')
  })

  it('fails when one measure is low and the others are unknown', () => {
    expect(fundamentalsState({ epsGrowthQoq: null, salesGrowthQoq: -5, roe: null })).toBe('fail')
  })

  it('does not hold missing measures against the stock', () => {
    expect(fundamentalsState({ epsGrowthQoq: 40, salesGrowthQoq: null, roe: null })).toBe('pass')
  })

  it('is unknown without any measure', () => {
    expect(fundamentalsState(null)).toBe('unknown')
    expect(fundamentalsState(undefined)).toBe('unknown')
    expect(fundamentalsState({ epsGrowthQoq: null, salesGrowthQoq: null, roe: null })).toBe('unknown')
  })
})

describe('fundamentalsMisses', () => {
  it('says which measure is short, with sign and the threshold', () => {
    expect(fundamentalsMisses(eg)).toEqual([
      'utili per azione +0% (ne servono oltre 25%)',
      'ricavi −14% (ne servono oltre 25%)',
      'ROE 13% (ne servono oltre 15%)',
    ])
  })

  it('is empty when nothing is short or there is nothing to judge', () => {
    expect(fundamentalsMisses(strong)).toEqual([])
    expect(fundamentalsMisses(null)).toEqual([])
  })
})
