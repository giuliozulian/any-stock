import { describe, it, expect } from 'vitest'
import { fairValue } from '@/lib/fair-value'

const base = { price: 100, epsTTM: 5, bookValuePerShare: 40, cashFlowPerShare: 6, epsGrowth5Y: 10, dividendYield: 1 }

describe('fairValue', () => {
  it('averages the applicable models and measures the premium of the price', () => {
    const r = fairValue(base)!
    expect(r.models.map((m) => m.key)).toEqual(['graham-number', 'graham-growth', 'lynch', 'cash-flow'])
    expect(r.models[0].value).toBeCloseTo(Math.sqrt(22.5 * 5 * 40), 5)
    expect(r.average).toBeCloseTo(r.models.reduce((s, m) => s + m.value, 0) / 4, 5)
    expect(r.premiumPct).toBeCloseTo(((100 - r.average) / r.average) * 100, 5)
  })

  it('skips earnings-based models when earnings are negative and needs at least two models', () => {
    expect(fairValue({ ...base, epsTTM: -1, cashFlowPerShare: null })).toBeNull()
  })
})
