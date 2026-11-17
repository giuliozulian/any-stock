import { describe, expect, it } from 'vitest'
import { computeVerdictNoteHash, parseVerdictNote, type VerdictNoteInput } from '@/lib/verdict-note'
import { evaluateStock } from '@/lib/evaluate'
import { fairValue } from '@/lib/fair-value'

const valid = { headline: 'Momentum forte ma conti da verificare', body: 'Primo.\n\nSecondo.', watchFor: ['Trimestrale'] }

describe('parseVerdictNote', () => {
  it('accepts a valid payload', () => {
    expect(parseVerdictNote(valid, 'm')).toMatchObject({ headline: valid.headline, watchFor: ['Trimestrale'], model: 'm' })
  })
  it('keeps at most 3 watch items and drops blanks', () => {
    const r = parseVerdictNote({ ...valid, watchFor: ['a', ' ', 'b', 'c', 'd'] }, 'm')
    expect(r?.watchFor).toEqual(['a', 'b', 'c'])
  })
  it('treats a missing watchFor as empty', () => {
    expect(parseVerdictNote({ headline: 'h', body: 'b' }, 'm')?.watchFor).toEqual([])
  })
  it.each([{ ...valid, headline: '' }, { ...valid, body: 3 }, null])('rejects invalid payload %#', (bad) => {
    expect(parseVerdictNote(bad, 'm')).toBeNull()
  })
})

describe('computeVerdictNoteHash', () => {
  const evaluation = evaluateStock({
    latestSnapshot: {
      price: 100, week52High: 120, week52Low: 80, relativePerf13W: 5, pegRatio: 1, roe: 20,
      debtToEquity: 0.5, netMargin: 10, dividendYield: null, payoutRatio: null, epsTTM: 4, epsGrowth5Y: 10,
    },
    earliestSnapshot: null,
    fairValue: null,
    recentRecommendations: [],
  })
  const base: VerdictNoteInput = {
    stock: { symbol: 'NVDA', name: 'NVIDIA' }, price: 100, changePct: 1, peRatio: 20,
    week52Low: 80, week52High: 120, evaluation, newsTone: 'positive',
  }

  it('ignores price ticks that do not change the signals', () => {
    expect(computeVerdictNoteHash({ ...base, price: 101, changePct: 2 })).toBe(computeVerdictNoteHash(base))
  })
  it('changes when the news tone changes', () => {
    expect(computeVerdictNoteHash({ ...base, newsTone: 'negative' })).not.toBe(computeVerdictNoteHash(base))
  })
  const snapshot = {
    price: 100, week52High: 120, week52Low: 80, relativePerf13W: 5, pegRatio: 1, roe: 20,
    debtToEquity: 0.5, netMargin: 10, dividendYield: null, payoutRatio: null, epsTTM: 4, epsGrowth5Y: 10,
  }
  const withFairValue = (price: number) =>
    evaluateStock({
      latestSnapshot: snapshot,
      earliestSnapshot: null,
      recentRecommendations: [],
      fairValue: fairValue({ price, epsTTM: 5, bookValuePerShare: 40, epsGrowth5Y: 10, dividendYield: 1, priceToFcf: 100 / 6 }), // the ratio is Finnhub's, fixed for the day: a price tick moves the cash flow numbers
    })

  it('changes when the fair value verdict changes, so notes written with the old target price are regenerated', () => {
    expect(computeVerdictNoteHash({ ...base, evaluation: withFairValue(100) })).not.toBe(computeVerdictNoteHash(base))
  })

  it('ignores price ticks that only move the numbers of the fair value, so the LLM is not called on every refresh', () => {
    expect(computeVerdictNoteHash({ ...base, evaluation: withFairValue(100) })).toBe(computeVerdictNoteHash({ ...base, evaluation: withFairValue(101.5) }))
  })
})
