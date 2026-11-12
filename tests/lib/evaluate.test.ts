import { describe, it, expect } from 'vitest'
import { evaluateStock, type EvaluateInput } from '@/lib/evaluate'

function baseInput(overrides: Partial<EvaluateInput['latestSnapshot']> = {}): EvaluateInput {
  return {
    latestSnapshot: {
      price: 100,
      week52High: null,
      week52Low: null,
      relativePerf13W: null,
      pegRatio: null,
      roe: null,
      debtToEquity: null,
      netMargin: null,
      dividendYield: null,
      payoutRatio: null,
      epsTTM: null,
      epsGrowth5Y: null,
      ...overrides,
    },
    earliestSnapshot: null,
    recentRecommendations: [],
  }
}

describe('evaluateStock — sinceWatching', () => {
  it('is null with a note when there is no earlier snapshot', () => {
    const result = evaluateStock(baseInput())
    expect(result.sinceWatching.pct).toBeNull()
    expect(result.sinceWatching.note).toMatch(/appena aggiunto/i)
  })

  it('computes the percent change from the earliest snapshot', () => {
    const input = baseInput()
    input.earliestSnapshot = { price: 100, timestamp: new Date('2026-10-01') }
    input.latestSnapshot.price = 120
    const result = evaluateStock(input)
    expect(result.sinceWatching.pct).toBeCloseTo(20)
    expect(result.sinceWatching.note).toContain('+20.0%')
  })

  it('shows a negative percent correctly', () => {
    const input = baseInput()
    input.earliestSnapshot = { price: 100, timestamp: new Date('2026-10-01') }
    input.latestSnapshot.price = 80
    const result = evaluateStock(input)
    expect(result.sinceWatching.pct).toBeCloseTo(-20)
    expect(result.sinceWatching.note).toContain('-20.0%')
  })

  it('is null instead of Infinity/NaN when the earliest stored price is zero or negative', () => {
    const input = baseInput()
    input.earliestSnapshot = { price: 0, timestamp: new Date('2026-10-01') }
    input.latestSnapshot.price = 80
    const result = evaluateStock(input)
    expect(result.sinceWatching.pct).toBeNull()
  })
})

describe('evaluateStock — shortTerm', () => {
  it('is "Dati non disponibili" (not a false Neutro reading) when 52-week range or relative performance is missing', () => {
    const result = evaluateStock(baseInput())
    expect(result.shortTerm.label).toBe('Dati non disponibili')
    expect(result.shortTerm.note).toMatch(/non disponibili/i)
  })

  it('is Positivo near the 52-week high with positive relative performance, and states both numbers', () => {
    const input = baseInput({ price: 195, week52High: 200, week52Low: 100, relativePerf13W: 2 })
    const result = evaluateStock(input)
    expect(result.shortTerm.label).toBe('Positivo')
    expect(result.shortTerm.note).toContain('95%')
    expect(result.shortTerm.note).toContain('+2')
  })

  it('is Negativo near the 52-week low with negative relative performance, and states both numbers', () => {
    const input = baseInput({ price: 105, week52High: 200, week52Low: 100, relativePerf13W: -2 })
    const result = evaluateStock(input)
    expect(result.shortTerm.label).toBe('Negativo')
    expect(result.shortTerm.note).toContain('5%')
    expect(result.shortTerm.note).toContain('-2')
  })

  it('is Neutro (a real reading, not missing data) when price sits mid-range', () => {
    const input = baseInput({ price: 150, week52High: 200, week52Low: 100, relativePerf13W: 1 })
    const result = evaluateStock(input)
    expect(result.shortTerm.label).toBe('Neutro')
  })
})

describe('evaluateStock — mediumTerm', () => {
  it('shows "Nessun dato disponibile" with no recommendations', () => {
    const result = evaluateStock(baseInput())
    expect(result.mediumTerm.label).toBe('Nessun dato disponibile')
  })

  it('is positive without a trend suffix with a single strongly-positive period', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 20, buy: 5, hold: 2, sell: 0, strongSell: 0 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.label).toBe('Consenso positivo')
  })

  it('reports improving consensus across two periods', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 20, buy: 5, hold: 2, sell: 0, strongSell: 0 },
      { period: new Date('2026-10-01'), strongBuy: 10, buy: 5, hold: 10, sell: 2, strongSell: 0 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.label).toBe('Consenso positivo, in miglioramento')
  })

  it('reports declining consensus across two periods', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 15, buy: 5, hold: 5, sell: 0, strongSell: 0 },
      { period: new Date('2026-10-01'), strongBuy: 20, buy: 5, hold: 2, sell: 0, strongSell: 0 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.label).toBe('Consenso positivo, ma in calo')
  })

  it('does not claim an improving trend when the score is unchanged across two periods', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 20, buy: 5, hold: 2, sell: 0, strongSell: 0 },
      { period: new Date('2026-10-01'), strongBuy: 20, buy: 5, hold: 2, sell: 0, strongSell: 0 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.label).toBe('Consenso positivo')
  })

  it('shows "Nessun dato disponibile" instead of a false neutral reading when the latest period has zero analysts', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.label).toBe('Nessun dato disponibile')
  })

  it('reports negative consensus', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 0, buy: 1, hold: 2, sell: 10, strongSell: 10 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.label).toBe('Consenso negativo')
  })

  it('includes the raw analyst counts in the note', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 11, buy: 19, hold: 15, sell: 3, strongSell: 1 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.note).toContain('30 analisti su 49')
    expect(result.mediumTerm.note).toContain('15 sono neutrali')
    expect(result.mediumTerm.note).toContain('4 raccomandano la vendita')
  })
})

describe('evaluateStock — longTerm', () => {
  it('shows "Dati fondamentali non disponibili" when PEG, ROE, and debt are all missing', () => {
    const result = evaluateStock(baseInput())
    expect(result.longTerm.label).toBe('Dati fondamentali non disponibili')
  })

  it('is "Fondamentali solidi" when PEG, ROE, and debt are all in their best bracket', () => {
    const input = baseInput({ pegRatio: 0.8, roe: 20, debtToEquity: 0.5 })
    const result = evaluateStock(input)
    expect(result.longTerm.label).toBe('Fondamentali solidi')
  })

  it('is "Fondamentali deboli" when ROE is negative, regardless of the others', () => {
    const input = baseInput({ pegRatio: 0.8, roe: -5, debtToEquity: 0.5 })
    const result = evaluateStock(input)
    expect(result.longTerm.label).toBe('Fondamentali deboli')
  })

  it('is "Fondamentali deboli" when debt is elevated, regardless of the others', () => {
    const input = baseInput({ pegRatio: 0.8, roe: 20, debtToEquity: 3 })
    const result = evaluateStock(input)
    expect(result.longTerm.label).toBe('Fondamentali deboli')
  })

  it('is "Fondamentali nella norma" for mid-range values', () => {
    const input = baseInput({ pegRatio: 1.5, roe: 8, debtToEquity: 1.2 })
    const result = evaluateStock(input)
    expect(result.longTerm.label).toBe('Fondamentali nella norma')
  })

  it('excludes a null or non-positive PEG from the combination without excluding ROE/debt data', () => {
    const input = baseInput({ pegRatio: null, roe: 20, debtToEquity: 0.5 })
    const result = evaluateStock(input)
    expect(result.longTerm.label).toBe('Fondamentali nella norma')
    expect(result.longTerm.note).toMatch(/PEG non disponibile/)
  })

  it('does not treat negative shareholder equity (negative debt/equity) as a healthy balance sheet', () => {
    const input = baseInput({ pegRatio: 0.8, roe: 20, debtToEquity: -3 })
    const result = evaluateStock(input)
    expect(result.longTerm.label).not.toBe('Fondamentali solidi')
    expect(result.longTerm.note).toMatch(/debito\/capitale non disponibile/)
  })

  it('includes a plain-language phrase for each metric in the note', () => {
    const input = baseInput({ pegRatio: 0.8, roe: 20, debtToEquity: 0.5 })
    const result = evaluateStock(input)
    expect(result.longTerm.note).toContain('sottovalutata rispetto alla crescita')
    expect(result.longTerm.note).toContain('redditività solida')
    expect(result.longTerm.note).toContain('indebitamento sano')
  })
})

describe('evaluateStock — targetPrice', () => {
  it('is not available when epsGrowth5Y is null', () => {
    const input = baseInput({ epsTTM: 6, epsGrowth5Y: null })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeNull()
    expect(result.targetPrice.note).toMatch(/non disponibile/i)
  })

  it('is not available when trailing EPS is zero or negative', () => {
    const input = baseInput({ epsTTM: -1, epsGrowth5Y: 15 })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeNull()
  })

  it('computes a value using the clamped growth rate as the fair P/E', () => {
    const input = baseInput({ price: 100, epsTTM: 5, epsGrowth5Y: 12 })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeCloseTo(60) // fairPE 12 * eps 5
    expect(result.targetPrice.upsidePct).toBeCloseTo(-40)
    expect(result.targetPrice.note).toMatch(/stima indicativa/i)
  })

  it('clamps an extreme growth rate to the formula\'s upper bound', () => {
    const input = baseInput({ price: 100, epsTTM: 5, epsGrowth5Y: 500 })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeCloseTo(200) // fairPE clamped to 40 * eps 5
  })

  it('is not available when EPS growth is negative, rather than clamping it to a fake floor', () => {
    const input = baseInput({ price: 100, epsTTM: 5, epsGrowth5Y: -10 })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeNull()
    expect(result.targetPrice.note).toMatch(/non disponibile/i)
  })

  it('is not available when EPS growth is exactly zero', () => {
    const input = baseInput({ price: 100, epsTTM: 5, epsGrowth5Y: 0 })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeNull()
  })

  it('is not available when the current price is zero or negative', () => {
    const input = baseInput({ price: 0, epsTTM: 5, epsGrowth5Y: 12 })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeNull()
  })
})

describe('evaluateStock — details', () => {
  it('passes the raw metric values through unchanged', () => {
    const input = baseInput({
      pegRatio: 1.1, roe: 18, debtToEquity: 0.9, netMargin: 22, dividendYield: 0.5, payoutRatio: 10,
    })
    const result = evaluateStock(input)
    expect(result.details).toEqual({
      pegRatio: 1.1, roe: 18, debtToEquity: 0.9, netMargin: 22, dividendYield: 0.5, payoutRatio: 10,
    })
  })
})
