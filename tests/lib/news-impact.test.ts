import { describe, it, expect } from 'vitest'
import { analyzeNewsImpact } from '@/lib/news-impact'

const stock = { symbol: 'BSX', name: 'Boston Scientific Corporation' }

describe('analyzeNewsImpact', () => {
  it('flags positive keywords as a positive impact and lists the matched signals', () => {
    const r = analyzeNewsImpact({ headline: 'Analyst upgrade: BSX raises price target after record quarter', summary: null }, stock)
    expect(r.tone).toBe('positive')
    expect(r.signals).toEqual(expect.arrayContaining(['upgrade', 'record']))
  })

  it('flags negative keywords as a negative impact', () => {
    const r = analyzeNewsImpact({ headline: 'Boston Scientific shares plunge on FDA recall and lawsuit', summary: null }, stock)
    expect(r.tone).toBe('negative')
  })

  it('is neutral when positive and negative signals cancel out or none are found', () => {
    expect(analyzeNewsImpact({ headline: 'Boston Scientific presents at healthcare conference', summary: null }, stock).tone).toBe('neutral')
    expect(analyzeNewsImpact({ headline: 'BSX stock rises despite recall', summary: null }, stock).tone).toBe('neutral')
  })

  it('also reads the summary, but weighs the headline more', () => {
    const r = analyzeNewsImpact({ headline: 'BSX update', summary: 'The company faces a probe and a lawsuit.' }, stock)
    expect(r.tone).toBe('negative')
  })

  it('marks news that does not mention the company as an indirect impact', () => {
    const direct = analyzeNewsImpact({ headline: 'Boston Scientific wins approval', summary: null }, stock)
    const indirect = analyzeNewsImpact({ headline: 'Medtronic growth surges', summary: null }, stock)
    expect(direct.direct).toBe(true)
    expect(indirect.direct).toBe(false)
  })

  it('does not match keywords inside other words', () => {
    const r = analyzeNewsImpact({ headline: 'BSX discusses the recorded webinar', summary: null }, stock)
    expect(r.signals).not.toContain('record')
  })
})
