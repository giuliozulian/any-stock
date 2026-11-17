import { describe, expect, it } from 'vitest'
import { buildMovePrompt, earningsExplanation, earningsMovedToday, isStale, parseMoveExplanation, tradingDay } from '@/lib/move-explanation'

const news = (n: number) => Array.from({ length: n }, (_, i) => ({ headline: `h${i}`, url: `https://x/${i}`, source: '', summary: '', datetime: 1_700_000_000 }))

describe('parseMoveExplanation', () => {
  it('accepts a clear explanation', () => {
    expect(parseMoveExplanation({ explanation: ' Trimestrale sopra attese. ', confidence: 'clear' }, 'm')).toEqual({
      explanation: 'Trimestrale sopra attese.', confidence: 'clear', model: 'm', sources: [],
    })
  })
  it('defaults unknown confidence to uncertain', () => {
    expect(parseMoveExplanation({ explanation: 'x', confidence: 'boh' }, 'm')?.confidence).toBe('uncertain')
  })
  it('maps the news numbers the model used to sources, ignoring invalid ones', () => {
    const out = parseMoveExplanation({ explanation: 'x', used: [2, 2, 99, 'a', 0] }, 'm', news(3))
    expect(out?.sources).toEqual([{ title: 'h1', url: 'https://x/1' }])
  })
  it.each([null, {}, { explanation: '  ' }, { explanation: 5 }])('rejects %#', (bad) => {
    expect(parseMoveExplanation(bad, 'm')).toBeNull()
  })
})

describe('buildMovePrompt', () => {
  it('states when there is no news', () => {
    expect(buildMovePrompt('ABC', 'Abc Inc', -12.3, [])).toContain('nessuna trovata')
  })
  it('limits and numbers headlines and signs the change', () => {
    const out = buildMovePrompt('ABC', 'Abc Inc', 8, news(12))
    expect(out).toContain('+8.00%')
    expect(out.match(/^\d+\. \[/gm)).toHaveLength(8)
  })
  it('lists SEC filings in plain Italian', () => {
    const out = buildMovePrompt('ABC', 'Abc Inc', 8, [], [{ date: '2026-11-16', items: ['1.01', '9.01'], url: '' }])
    expect(out).toContain('accordo importante firmato')
  })
})

describe('tradingDay', () => {
  it('uses the exchange time zone, not UTC', () => {
    // 01:00 UTC on the 18th is still the evening of the 17th in New York.
    expect(tradingDay(new Date('2026-11-18T01:00:00Z'))).toBe('2026-11-17')
    expect(tradingDay(new Date('2026-11-18T01:00:00Z'), 'Asia/Shanghai')).toBe('2026-11-18')
  })
})

describe('earningsMovedToday', () => {
  const e = (date: string, hour: string | null) => ({ date, hour, epsActual: 1, epsEstimate: 1 })
  it('accepts a pre-market report today or an after-close report yesterday', () => {
    expect(earningsMovedToday(e('2026-11-17', 'bmo'), '2026-11-17')).toBe(true)
    expect(earningsMovedToday(e('2026-11-16', 'amc'), '2026-11-17')).toBe(true)
  })
  it('rejects a report that cannot have moved today', () => {
    expect(earningsMovedToday(e('2026-11-17', 'amc'), '2026-11-17')).toBe(false)
    expect(earningsMovedToday(e('2026-11-16', 'bmo'), '2026-11-17')).toBe(false)
  })
})

describe('earningsExplanation', () => {
  it('compares reported EPS with the estimate', () => {
    expect(earningsExplanation({ date: '2026-11-16', hour: 'amc', epsActual: 1.2, epsEstimate: 1 })).toBe(
      'Ha pubblicato i risultati trimestrali dopo la chiusura del 16/11: utile per azione 1.20 contro 1.00 atteso, sopra le stime (+20%).'
    )
  })
  it('degrades without numbers', () => {
    expect(earningsExplanation({ date: '2026-11-17', hour: null, epsActual: null, epsEstimate: null })).toBe('Ha pubblicato i risultati trimestrali il 17/11.')
  })
})

describe('isStale', () => {
  it('rebuilds an AI note once the move drifted, never a fact-based one', () => {
    expect(isStale({ changePct: 10, kind: 'ai' }, 14)).toBe(true)
    expect(isStale({ changePct: 10, kind: 'ai' }, 11)).toBe(false)
    expect(isStale({ changePct: 10, kind: 'fact' }, 30)).toBe(false)
  })
})
