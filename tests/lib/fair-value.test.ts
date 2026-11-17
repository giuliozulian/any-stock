import { describe, expect, it } from 'vitest'
import { buildFairValueInput, fairValue, fairValueModels, lynchValue, summarizeModels, type FairValueInput, type FairValueModel } from '@/lib/fair-value'

// Free cash flow per share of 6 on a price of 100: priceToFcf = 100 / 6.
const base: FairValueInput = { price: 100, epsTTM: 5, bookValuePerShare: 40, epsGrowth5Y: 10, dividendYield: 1, priceToFcf: 100 / 6 }

// Four models that agree within a 2x spread. Models: Graham number 106.07, Graham growth 188.22, Lynch 125, cash flow 145.50.
const agreeing = (price: number): FairValueInput => ({ price, epsTTM: 5, bookValuePerShare: 100, epsGrowth5Y: 25, dividendYield: 0, priceToFcf: price / 4.5 })

const m = (key: FairValueModel['key'], value: number): FairValueModel => ({ key, label: key, value })
const keys = (r: { models: FairValueModel[] }) => r.models.map((x) => x.key)
const valueOf = (r: { models: FairValueModel[] }, key: FairValueModel['key']) => r.models.find((x) => x.key === key)?.value
const reasonOf = (r: { excluded: Array<{ key: string; reason: string }> }, key: string) => r.excluded.find((x) => x.key === key)?.reason

describe('lynchValue', () => {
  it('multiplies earnings by a fair P/E equal to growth plus dividend yield', () => {
    expect(lynchValue(5, 10, 1)).toBeCloseTo(55, 6)
  })

  it('floors the fair P/E at 5 and caps it at 25', () => {
    expect(lynchValue(5, 3, 0)).toBeCloseTo(25, 6)
    expect(lynchValue(5, 40, 0)).toBeCloseTo(125, 6)
  })
})

describe('buildFairValueInput', () => {
  it('maps the Finnhub metrics, turning absent optional fields into null', () => {
    expect(buildFairValueInput(100, { epsTTM: 5, epsGrowth5Y: 10, dividendYield: 1 })).toEqual({
      price: 100, epsTTM: 5, bookValuePerShare: null, epsGrowth5Y: 10, dividendYield: 1, priceToFcf: null,
    })
    expect(buildFairValueInput(100, { epsTTM: 5, bookValuePerShare: 40, epsGrowth5Y: 10, dividendYield: 1, priceToFcf: 20 })).toMatchObject({
      bookValuePerShare: 40, priceToFcf: 20,
    })
  })
})

describe('fairValueModels', () => {
  it('computes the four models on complete data', () => {
    const r = fairValueModels(base)
    expect(keys(r)).toEqual(['graham-number', 'graham-growth', 'lynch', 'cash-flow'])
    expect(valueOf(r, 'graham-number')).toBeCloseTo(Math.sqrt(22.5 * 5 * 40), 5) // 67.082
    expect(valueOf(r, 'graham-growth')).toBeCloseTo(139.3333, 3) // 5 * (8.5 + 20) * 4.4 / 4.5
    expect(valueOf(r, 'lynch')).toBeCloseTo(55, 5)
    expect(valueOf(r, 'cash-flow')).toBeCloseTo(166.7754, 3)
    expect(r.excluded).toEqual([])
  })

  it('takes the free cash flow per share as price divided by price-to-FCF', () => {
    const r = fairValueModels({ ...base, priceToFcf: 20 }) // 100 / 20 = 5, not 6
    expect(valueOf(r, 'cash-flow')).toBeCloseTo(138.9795, 3)
  })

  describe('Graham number', () => {
    it('is left out when book value per share is under 10% of the price, with the reason', () => {
      const r = fairValueModels({ ...base, bookValuePerShare: 9 })
      expect(keys(r)).not.toContain('graham-number')
      expect(reasonOf(r, 'graham-number')).toMatch(/pochi attivi/)
    })

    it('is kept at exactly 10% of the price', () => {
      expect(keys(fairValueModels({ ...base, bookValuePerShare: 10 }))).toContain('graham-number')
    })

    it.each([
      ['earnings missing', { epsTTM: null }],
      ['earnings negative', { epsTTM: -1 }],
      ['book value missing', { bookValuePerShare: null }],
      ['book value negative', { bookValuePerShare: -5 }],
    ])('is left out when %s, with the reason', (_name, override) => {
      const r = fairValueModels({ ...base, ...override })
      expect(keys(r)).not.toContain('graham-number')
      expect(reasonOf(r, 'graham-number')).toMatch(/Mancano utile o patrimonio/)
    })
  })

  describe('earnings and growth', () => {
    it('leaves out both earnings models, but not the cash flow, when earnings are negative', () => {
      const r = fairValueModels({ ...base, epsTTM: -1 })
      expect(keys(r)).toEqual(['cash-flow'])
      expect(reasonOf(r, 'graham-growth')).toMatch(/Utile per azione negativo/)
      expect(reasonOf(r, 'lynch')).toMatch(/Utile per azione negativo/)
    })

    it('leaves out every growth-based model when growth is unknown, instead of assuming 0', () => {
      const r = fairValueModels({ ...base, epsGrowth5Y: null })
      expect(keys(r)).toEqual(['graham-number'])
      expect(reasonOf(r, 'graham-growth')).toMatch(/Crescita degli utili non disponibile/)
      expect(reasonOf(r, 'lynch')).toMatch(/Crescita degli utili non disponibile/)
      expect(reasonOf(r, 'cash-flow')).toMatch(/Crescita degli utili non disponibile/)
    })

    it('treats negative growth as zero for Graham and the cash flow, and leaves Lynch out', () => {
      const r = fairValueModels({ ...base, epsGrowth5Y: -8 })
      expect(valueOf(r, 'graham-growth')).toBeCloseTo(5 * 8.5 * 4.4 / 4.5, 4) // 41.556: no growth at all
      expect(valueOf(r, 'cash-flow')).toBeCloseTo(78.4725, 3) // 6 per share, flat
      expect(keys(r)).not.toContain('lynch')
      expect(reasonOf(r, 'lynch')).toMatch(/non disponibile o non positiva/)
    })

    it('also leaves Lynch out when growth is exactly zero', () => {
      expect(keys(fairValueModels({ ...base, epsGrowth5Y: 0 }))).not.toContain('lynch')
    })

    it('caps growth at 15% for Graham, 12% for the cash flow and a P/E of 25 for Lynch', () => {
      const r = fairValueModels({ ...base, epsGrowth5Y: 40, dividendYield: 0 })
      expect(valueOf(r, 'graham-growth')).toBeCloseTo(188.2222, 3) // growth 15
      expect(valueOf(r, 'cash-flow')).toBeCloseTo(194.0055, 3) // growth 12
      expect(valueOf(r, 'lynch')).toBeCloseTo(125, 5) // P/E 25
    })
  })

  describe('cash flow', () => {
    it.each([null, 0, -4])('is left out, and only it, when price-to-FCF is %s', (ratio) => {
      const r = fairValueModels({ ...base, priceToFcf: ratio })
      expect(keys(r)).toEqual(['graham-number', 'graham-growth', 'lynch'])
      expect(reasonOf(r, 'cash-flow')).toMatch(/Flusso di cassa libero/)
    })

    it('is left out when the price is not positive', () => {
      expect(keys(fairValueModels({ ...base, price: 0 }))).not.toContain('cash-flow')
    })
  })

  describe('values that are not finite numbers', () => {
    it('treats NaN and Infinity as missing data and never produces NaN', () => {
      const r = fairValueModels({ ...base, epsTTM: Number.NaN, epsGrowth5Y: Number.POSITIVE_INFINITY, bookValuePerShare: Number.NaN, priceToFcf: Number.NaN })
      expect(r.models).toEqual([])
      expect(r.excluded).toHaveLength(4)
    })

    it('never lets a model with a non-finite or non-positive value through', () => {
      const r = fairValueModels({ ...base, epsTTM: Number.MAX_VALUE, bookValuePerShare: Number.MAX_VALUE })
      expect(r.models.every((x) => Number.isFinite(x.value) && x.value > 0)).toBe(true)
    })
  })
})

describe('summarizeModels', () => {
  const models = [m('graham-number', 100), m('lynch', 150), m('cash-flow', 200)]

  it('gives the range, the median and the spread', () => {
    const s = summarizeModels(models, 120)!
    expect(s.low).toBe(100)
    expect(s.high).toBe(200)
    expect(s.median).toBe(150)
    expect(s.spread).toBe(2)
  })

  it('takes the mean of the two middle values as median when the count is even', () => {
    expect(summarizeModels([m('lynch', 100), m('cash-flow', 120), m('graham-number', 140), m('graham-growth', 160)], 100)!.median).toBe(130)
  })

  it('does not depend on the order of the models', () => {
    expect(summarizeModels([...models].reverse(), 120)).toEqual(summarizeModels(models, 120))
  })

  it('is reliable up to a spread of exactly 2 and not beyond', () => {
    expect(summarizeModels([m('lynch', 100), m('cash-flow', 200)], 150)!.reliable).toBe(true)
    expect(summarizeModels([m('lynch', 100), m('cash-flow', 201)], 150)!.reliable).toBe(false)
  })

  it('places the price below, inside and above the range, inclusive of both ends', () => {
    expect(summarizeModels(models, 90)!.position).toBe('below')
    expect(summarizeModels(models, 100)!.position).toBe('inside')
    expect(summarizeModels(models, 150)!.position).toBe('inside')
    expect(summarizeModels(models, 200)!.position).toBe('inside')
    expect(summarizeModels(models, 210)!.position).toBe('above')
  })

  it('measures the premium against the median only when the estimate is reliable', () => {
    expect(summarizeModels(models, 120)!.premiumPct).toBeCloseTo(-20, 6) // (120 - 150) / 150
    expect(summarizeModels([m('lynch', 100), m('cash-flow', 400)], 120)!.premiumPct).toBeNull()
  })

  it('says "unclear" instead of a position when the models disagree', () => {
    expect(summarizeModels([m('lynch', 100), m('cash-flow', 400)], 50)!.position).toBe('unclear')
  })

  it('needs at least two models and a positive price', () => {
    expect(summarizeModels([m('lynch', 100)], 100)).toBeNull()
    expect(summarizeModels([], 100)).toBeNull()
    expect(summarizeModels(models, 0)).toBeNull()
    expect(summarizeModels(models, -5)).toBeNull()
  })
})

describe('fairValue', () => {
  it('combines models, exclusions and the summary', () => {
    const r = fairValue(base)!
    expect(keys(r)).toHaveLength(4)
    expect(r.low).toBeCloseTo(55, 5)
    expect(r.high).toBeCloseTo(166.7754, 3)
    expect(r.median).toBeCloseTo(103.2077, 3) // (67.082 + 139.333) / 2
    expect(r.reliable).toBe(false) // 166.78 / 55 = 3.03
    expect(r.position).toBe('unclear')
  })

  it('gives a reliable range and a position when the models agree', () => {
    const inside = fairValue(agreeing(150))!
    expect(inside.low).toBeCloseTo(106.066, 2)
    expect(inside.high).toBeCloseTo(188.2222, 3)
    expect(inside.median).toBeCloseTo(135.252, 2)
    expect(inside.reliable).toBe(true)
    expect(inside.position).toBe('inside')
    expect(inside.premiumPct).toBeCloseTo(((150 - 135.252) / 135.252) * 100, 3)
    expect(fairValue(agreeing(90))!.position).toBe('below')
    expect(fairValue(agreeing(250))!.position).toBe('above')
  })

  it('returns null with fewer than two models', () => {
    expect(fairValue({ price: 100, epsTTM: null, bookValuePerShare: null, epsGrowth5Y: 10, dividendYield: null, priceToFcf: 20 })).toBeNull()
    expect(fairValue({ price: 100, epsTTM: null, bookValuePerShare: null, epsGrowth5Y: null, dividendYield: null, priceToFcf: null })).toBeNull()
  })

  it('returns null for a price that is not positive', () => {
    expect(fairValue({ ...base, price: 0 })).toBeNull()
  })

  describe('with the real Finnhub data of 17 November 2026 (prices rounded)', () => {
    it('AAPL: Graham number is left out and the remaining models disagree', () => {
      const r = fairValue({ price: 350, epsTTM: 8.9745, bookValuePerShare: 7.7134, epsGrowth5Y: 9.85, dividendYield: 0.3036, priceToFcf: 38.0533 })!
      expect(keys(r)).toEqual(['graham-growth', 'lynch', 'cash-flow'])
      expect(reasonOf(r, 'graham-number')).toMatch(/pochi attivi/)
      expect(valueOf(r, 'graham-growth')).toBeCloseTo(247.46, 1)
      expect(valueOf(r, 'lynch')).toBeCloseTo(91.12, 1)
      expect(valueOf(r, 'cash-flow')).toBeCloseTo(252.77, 1)
      expect(r.reliable).toBe(false)
      expect(r.position).toBe('unclear')
    })

    it('MCD: Graham number is left out and the models still disagree (spread 2.14)', () => {
      const r = fairValue({ price: 270, epsTTM: 12.6401, bookValuePerShare: 7.8164, epsGrowth5Y: 13.64, dividendYield: 2.722, priceToFcf: 24.7329 })!
      expect(keys(r)).toEqual(['graham-growth', 'lynch', 'cash-flow'])
      expect(r.low).toBeCloseTo(206.82, 1)
      expect(r.high).toBeCloseTo(442.21, 1)
      expect(r.reliable).toBe(false)
    })

    it('JPM: all four models apply and they are far apart', () => {
      const r = fairValue({ price: 300, epsTTM: 24.373, bookValuePerShare: 134.4218, epsGrowth5Y: 16.8, dividendYield: 1.8986, priceToFcf: 6.0133 })!
      expect(keys(r)).toHaveLength(4)
      expect(r.low).toBeCloseTo(271.51, 1)
      expect(r.high).toBeCloseTo(1613.14, 0)
      expect(r.reliable).toBe(false)
    })
  })
})
