import { describe, it, expect } from 'vitest'
import { evaluateStock, fairValueTone, newsTone, overallScore, verdictTones, RULES_VERSION, type EvaluateInput, type Evaluation } from '@/lib/evaluate'

const NOW = new Date('2026-11-20T08:30:00Z')

const strongInput: EvaluateInput = {
  latestSnapshot: {
    price: 95, week52High: 100, week52Low: 50, relativePerf13W: 5, pegRatio: 0.8, roe: 20, debtToEquity: 0.5,
    netMargin: 10, dividendYield: 1, payoutRatio: 20, epsTTM: 5, epsGrowth5Y: 10,
  },
  earliestSnapshot: null,
  fairValue: null,
  recentRecommendations: [{ period: new Date('2026-11-01'), strongBuy: 10, buy: 5, hold: 1, sell: 0, strongSell: 0 }],
  newsAnalyses: [],
  now: NOW,
}

describe('overallScore', () => {
  it('is null when no signal has data', () => {
    expect(overallScore(['unknown', 'unknown', 'unknown'], 'below', 1)).toBeNull()
  })

  it('adds fair value and news to the signal balance', () => {
    expect(overallScore(['positive', 'positive', 'neutral'], 'below', 1)).toBe(4)
    expect(overallScore(['negative', 'neutral', 'unknown'], 'above', -1)).toBe(-3)
  })

  it('ignores an unclear fair value', () => {
    expect(overallScore(['positive', 'neutral', 'neutral'], 'unclear')).toBe(1)
  })
})

describe('fairValueTone', () => {
  const fv = (position: Evaluation['fairValue']['position'], reliable: boolean): Evaluation['fairValue'] => ({ position, reliable, low: 1, high: 2, median: 1.5, note: '' })

  it('maps a reliable position to a tone', () => {
    expect(fairValueTone(fv('below', true))).toBe('positive')
    expect(fairValueTone(fv('above', true))).toBe('negative')
    expect(fairValueTone(fv('inside', true))).toBe('neutral')
  })

  it('is unknown when the estimate is missing or unreliable', () => {
    expect(fairValueTone(fv(null, false))).toBe('unknown')
    expect(fairValueTone(fv('unclear', false))).toBe('unknown')
  })
})

describe('newsTone', () => {
  const news = (counted: number, adjustment: -1 | 0 | 1) => ({ counted, positive: 0, negative: 0, net: 0, adjustment, note: '' })

  it('is unknown when no news was counted', () => {
    expect(newsTone(news(0, 0))).toBe('unknown')
  })

  it('follows the adjustment when news was counted', () => {
    expect(newsTone(news(3, 1))).toBe('positive')
    expect(newsTone(news(3, -1))).toBe('negative')
    expect(newsTone(news(3, 0))).toBe('neutral')
  })
})

describe('verdictTones', () => {
  it('reads every signal and the overall verdict from an evaluation', () => {
    const tones = verdictTones(evaluateStock(strongInput))
    expect(tones).toEqual({ overall: 'positive', score: 3, shortTerm: 'positive', mediumTerm: 'positive', longTerm: 'positive', fairValue: 'unknown', news: 'unknown' })
  })

  it('marks a stock with no data as unknown with a null score', () => {
    const empty: EvaluateInput = {
      ...strongInput,
      latestSnapshot: { ...strongInput.latestSnapshot, week52High: null, week52Low: null, relativePerf13W: null, pegRatio: null, roe: null, debtToEquity: null },
      recentRecommendations: [],
    }
    expect(verdictTones(evaluateStock(empty))).toEqual({ overall: 'unknown', score: null, shortTerm: 'unknown', mediumTerm: 'unknown', longTerm: 'unknown', fairValue: 'unknown', news: 'unknown' })
  })
})

it('exposes the rules version', () => {
  expect(RULES_VERSION).toBe(1)
})
