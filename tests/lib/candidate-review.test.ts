import { describe, expect, it } from 'vitest'
import { buildReviewPrompt, parseCandidateReview } from '@/lib/candidate-review'

describe('parseCandidateReview', () => {
  it('accepts solid and caution', () => {
    expect(parseCandidateReview({ verdict: 'caution', note: ' Un solo politico. ' })).toEqual({ verdict: 'caution', note: 'Un solo politico.' })
    expect(parseCandidateReview({ verdict: 'solid', note: 'ok' })?.verdict).toBe('solid')
  })
  it.each([null, { verdict: 'maybe', note: 'x' }, { verdict: 'solid', note: ' ' }, { note: 'x' }])('rejects %#', (bad) => {
    expect(parseCandidateReview(bad)).toBeNull()
  })
})

describe('buildReviewPrompt', () => {
  it('shows an unmeasured pillar as n.d. and lists the warnings', () => {
    const out = buildReviewPrompt({ symbol: 'AB', name: 'Ab', market: 'IT', score: 50, momentumScore: 50, fundamentalsScore: 50, insiderScore: -1, partial: false, reason: 'x', flags: ['Trimestrale domani'] })
    expect(out).toContain('persone n.d.')
    expect(out).toContain('Avvisi: Trimestrale domani')
  })

  const c = { symbol: 'AB', name: 'Ab', market: 'US', score: 80, momentumScore: 70, fundamentalsScore: 60, insiderScore: 96, partial: true, reason: 'titolo\nInsider: 1 politico' }
  it('includes scores, reason and incomplete-data flag', () => {
    const out = buildReviewPrompt(c)
    expect(out).toContain('persone 96, qualità 60, momento 70')
    expect(out).toContain('Insider: 1 politico')
    expect(out).toContain('Dati incompleti')
  })
})
