import { describe, it, expect } from 'vitest'
import { scoreCandidate, type ScoreInput } from '@/lib/discover'

function baseInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    price: 100,
    week52High: null,
    week52Low: null,
    changePct: 0,
    pegRatio: null,
    roe: null,
    debtToEquity: null,
    congressSignalScore: null,
    insiderBuyerCount: 0,
    market: 'US',
    ...overrides,
  }
}

describe('scoreCandidate — momentum', () => {
  it('scores purely on move size when 52-week range is missing', () => {
    const result = scoreCandidate(baseInput({ changePct: 30 }))
    expect(result.momentumScore).toBe(100)
  })

  it('averages range position and move size when both are available', () => {
    // price at the exact 52-week high -> rangePoints = 100; changePct 15 -> movePoints = 50
    const result = scoreCandidate(baseInput({ price: 180, week52High: 180, week52Low: 120, changePct: 15 }))
    expect(result.momentumScore).toBe(75)
  })

  it('caps move points at 100 for moves at or above 30%', () => {
    const result = scoreCandidate(baseInput({ changePct: -45 }))
    expect(result.momentumScore).toBe(100)
  })
})

describe('scoreCandidate — fundamentals', () => {
  it('gives full points for PEG<=1, ROE>15, debt<1', () => {
    const result = scoreCandidate(baseInput({ pegRatio: 0.8, roe: 20, debtToEquity: 0.5 }))
    expect(result.fundamentalsScore).toBe(100)
  })

  it('gives partial points for mid-band values', () => {
    const result = scoreCandidate(baseInput({ pegRatio: 1.5, roe: 10, debtToEquity: 1.5 }))
    expect(result.fundamentalsScore).toBe(20 + 20 + 10)
  })

  it('gives zero points for a loss-making, overleveraged, overpriced stock', () => {
    const result = scoreCandidate(baseInput({ pegRatio: 3, roe: -5, debtToEquity: 2.5 }))
    expect(result.fundamentalsScore).toBe(0)
  })

  it('treats null fundamentals as zero points, never a crash', () => {
    const result = scoreCandidate(baseInput())
    expect(result.fundamentalsScore).toBe(0)
  })
})

describe('scoreCandidate — insider/congress', () => {
  it('is always zero for the Italian market, regardless of other inputs', () => {
    const result = scoreCandidate(baseInput({ market: 'IT', congressSignalScore: 15, insiderBuyerCount: 5 }))
    expect(result.insiderScore).toBe(0)
  })

  it('normalizes a congress signal score onto the 0-100 scale', () => {
    const result = scoreCandidate(baseInput({ congressSignalScore: 6 }))
    expect(result.insiderScore).toBe(50)
  })

  it('takes the stronger of congress and insider signals, not their sum', () => {
    const result = scoreCandidate(baseInput({ congressSignalScore: 6, insiderBuyerCount: 4 }))
    expect(result.insiderScore).toBe(100)
  })

  it('is zero when there is no signal at all', () => {
    const result = scoreCandidate(baseInput())
    expect(result.insiderScore).toBe(0)
  })
})

describe('scoreCandidate — combined score and reason', () => {
  it('averages three pillars for US stocks', () => {
    const result = scoreCandidate(baseInput({ changePct: 30, pegRatio: 0.8, roe: 20, debtToEquity: 0.5, congressSignalScore: 12 }))
    expect(result.score).toBe(100)
  })

  it('averages only two pillars for IT stocks', () => {
    const result = scoreCandidate(baseInput({ market: 'IT', changePct: 30, pegRatio: 0.8, roe: 20, debtToEquity: 0.5 }))
    expect(result.score).toBe(100)
  })

  it('mentions the Italian market disclaimer in the reason', () => {
    const result = scoreCandidate(baseInput({ market: 'IT' }))
    expect(result.reason).toContain('Mercato italiano')
  })

  it('falls back to a generic reason when every pillar is weak', () => {
    const result = scoreCandidate(baseInput())
    expect(result.reason).toContain('Segnale debole')
  })
})
