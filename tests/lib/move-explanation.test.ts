import { describe, expect, it } from 'vitest'
import { buildMovePrompt, parseMoveExplanation } from '@/lib/move-explanation'

describe('parseMoveExplanation', () => {
  it('accepts a clear explanation', () => {
    expect(parseMoveExplanation({ explanation: ' Trimestrale sopra attese. ', confidence: 'clear' }, 'm')).toEqual({
      explanation: 'Trimestrale sopra attese.', confidence: 'clear', model: 'm',
    })
  })
  it('defaults unknown confidence to uncertain', () => {
    expect(parseMoveExplanation({ explanation: 'x', confidence: 'boh' }, 'm')?.confidence).toBe('uncertain')
  })
  it.each([null, {}, { explanation: '  ' }, { explanation: 5 }])('rejects %#', (bad) => {
    expect(parseMoveExplanation(bad, 'm')).toBeNull()
  })
})

describe('buildMovePrompt', () => {
  it('states when there is no news', () => {
    expect(buildMovePrompt('ABC', 'Abc Inc', -12.3, [])).toContain('nessuna trovata')
  })
  it('limits headlines and signs the change', () => {
    const news = Array.from({ length: 12 }, (_, i) => ({ headline: `h${i}`, url: '', source: '', summary: '', datetime: 1_700_000_000 }))
    const out = buildMovePrompt('ABC', 'Abc Inc', 8, news)
    expect(out).toContain('+8.00%')
    expect(out.match(/^- \[/gm)).toHaveLength(8)
  })
})
