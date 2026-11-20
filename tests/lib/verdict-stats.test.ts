import { describe, it, expect } from 'vitest'
import { summarize, toTone, type StatRow } from '@/lib/verdict-stats'

const tones = (overall: StatRow['tones']['overall']): StatRow['tones'] => ({ overall, shortTerm: overall, mediumTerm: 'unknown', longTerm: 'unknown', fairValue: 'unknown', news: 'unknown' })
const row = (overall: StatRow['tones']['overall'], stockReturnPct: number, excessPct: number): StatRow => ({ horizon: 10, tones: tones(overall), stockReturnPct, excessPct })

describe('summarize', () => {
  it('counts wins, losses and neutrals and rates wins over wins plus losses', () => {
    const s = summarize([row('positive', 3, 3), row('positive', -3, -3), row('positive', 1, 1), row('positive', 5, 5)], 'overall')
    expect(s.matured).toBe(4)
    expect(s.abs).toEqual({ win: 2, loss: 1, neutral: 1, rate: (2 / 3) * 100 })
  })

  it('judges the relative result on the excess return, not on the stock return', () => {
    const s = summarize([row('positive', 5, -3), row('positive', 5, 4)], 'overall')
    expect(s.abs.win).toBe(2)
    expect(s.rel).toEqual({ win: 1, loss: 1, neutral: 0, rate: 50 })
  })

  it('keeps neutral verdicts as a comparison group without results', () => {
    const s = summarize([row('neutral', 2, 1), row('neutral', 4, 3), row('positive', 6, 5)], 'overall')
    expect(s.byTone.neutral).toEqual({ count: 2, avgReturnPct: 3, avgExcessPct: 2 })
    expect(s.abs.win).toBe(1)
    expect(s.matured).toBe(3)
  })

  it('splits the average returns by tone', () => {
    const s = summarize([row('positive', 4, 2), row('positive', 2, 0), row('negative', -2, -1)], 'overall')
    expect(s.byTone.positive).toEqual({ count: 2, avgReturnPct: 3, avgExcessPct: 1 })
    expect(s.byTone.negative).toEqual({ count: 1, avgReturnPct: -2, avgExcessPct: -1 })
  })

  it('leaves out rows where that signal had no data', () => {
    const s = summarize([row('positive', 3, 3)], 'longTerm')
    expect(s.matured).toBe(0)
  })

  it('has no rate and no averages when there are no matured verdicts', () => {
    const s = summarize([], 'overall')
    expect(s.matured).toBe(0)
    expect(s.abs).toEqual({ win: 0, loss: 0, neutral: 0, rate: null })
    expect(s.rel.rate).toBeNull()
    expect(s.byTone.positive).toEqual({ count: 0, avgReturnPct: null, avgExcessPct: null })
  })
})

describe('toTone', () => {
  it('accepts the four tones and treats anything else as unknown', () => {
    expect(toTone('positive')).toBe('positive')
    expect(toTone('negative')).toBe('negative')
    expect(toTone('neutral')).toBe('neutral')
    expect(toTone('unknown')).toBe('unknown')
    expect(toTone('garbage')).toBe('unknown')
  })
})
