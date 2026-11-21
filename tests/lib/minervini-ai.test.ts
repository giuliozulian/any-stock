import { describe, expect, it, vi } from 'vitest'
import type { Bar } from '@/lib/history'
import { detectVcp, evaluateTrendTemplate } from '@/lib/minervini'
import type { MinerviniAnalysis } from '@/lib/minervini-data'
import { PROMPT_VERSION, buildInput, buildSystemPrompt, buildUserPrompt, computeHash, generateAiResult, isAiResult, parseAiResult, type AiInput } from '@/lib/minervini-ai'

const DAY = 86_400_000
const uptrend: Bar[] = Array.from({ length: 300 }, (_, i) => {
  const close = 100 + i * 0.5
  return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
})

function analysis(): MinerviniAnalysis {
  const template = evaluateTrendTemplate(uptrend, 80)!
  return { template, vcp: detectVcp(uptrend), peerCount: 12 }
}

describe('buildInput', () => {
  it('keeps the essentials and numbers the criteria TT1..TT8', () => {
    const input = buildInput('AAPL', analysis())
    expect(input.symbol).toBe('AAPL')
    expect(input.peerCount).toBe(12)
    expect(input.price).toBeCloseTo(249.5, 1)
    expect(input.trendTemplate.criteria.map((c) => c.id)).toEqual(['TT1', 'TT2', 'TT3', 'TT4', 'TT5', 'TT6', 'TT7', 'TT8'])
    expect(input.trendTemplate.total).toBe(8)
    expect(input.vcp).toHaveProperty('status')
    expect(input).not.toHaveProperty('candles')
  })

  it('rounds numbers so a hash does not move on noise', () => {
    const a = analysis()
    const b = analysis()
    b.template.levels[0] = { ...b.template.levels[0], value: b.template.levels[0].value + 1e-9 }
    expect(computeHash(buildInput('AAPL', a))).toBe(computeHash(buildInput('AAPL', b)))
  })
})

describe('computeHash', () => {
  it('changes when the input changes', () => {
    const a = buildInput('AAPL', analysis())
    const b = buildInput('AAPL', { ...analysis(), peerCount: 13 })
    expect(computeHash(a)).not.toBe(computeHash(b))
  })

  it('is a sha256 hex string and depends on the prompt version', () => {
    const h = computeHash(buildInput('AAPL', analysis()))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(PROMPT_VERSION).toBeGreaterThan(0)
  })
})

const goodBase = { weeks: 12, depth: 0.25, tightness: 0.02, ratios: [0.48, 0.5], halves: true, weeksOk: true, depthOk: true }

const passing = (): AiInput => {
  const input = buildInput('AAPL', analysis())
  return {
    ...input,
    trendTemplate: { ...input.trendTemplate, passedCount: input.trendTemplate.total, criteria: input.trendTemplate.criteria.map((c) => ({ ...c, ok: true })) },
    vcp: { ...input.vcp, status: 'forming' },
    base: goodBase,
  }
}

const raw = (over: Record<string, unknown> = {}) => ({
  verdict: 'ready',
  summary: 'Il titolo rispetta il Trend Template e la base è stretta.',
  criteria: [{ ruleId: 'TT1', outcome: 'met', note: 'Prezzo sopra le medie.' }],
  missing: [],
  risks: ['Campione RS piccolo'],
  uncovered: ['Fondamentali'],
  ...over,
})

describe('buildInput fundamentals and VWAP', () => {
  it('sends the fundamentals and the rounded VWAP, null when unknown', () => {
    const eg = { epsGrowthQoq: 0.18, salesGrowthQoq: -13.85, roe: 12.51 }
    const input = buildInput('EG', { ...analysis(), fundamentals: eg, avwap: 98.123456789 })
    expect(input.fundamentals).toEqual(eg)
    expect(input.avwap).toBeCloseTo(98.1235, 4)
    const bare = buildInput('EG', analysis())
    expect(bare.fundamentals).toBeNull()
    expect(bare.avwap).toBeNull()
  })

  it('changes the hash when the fundamentals change', () => {
    const a = buildInput('EG', { ...analysis(), fundamentals: { epsGrowthQoq: 40, salesGrowthQoq: 30, roe: 20 } })
    const b = buildInput('EG', { ...analysis(), fundamentals: { epsGrowthQoq: 1, salesGrowthQoq: 30, roe: 20 } })
    expect(computeHash(a)).not.toBe(computeHash(b))
  })
})

describe('computeHash versions', () => {
  it('changes with the rulebook version and with the prompt version', () => {
    const input = buildInput('AAPL', analysis())
    const base = computeHash(input)
    expect(computeHash(input, 99)).not.toBe(base)
    expect(computeHash(input, undefined, 99)).not.toBe(base)
  })
})

describe('prompts', () => {
  it('puts every rule and the output rules in the system prompt', () => {
    const p = buildSystemPrompt()
    expect(p).toContain('TT1 [calcolo, confermata]')
    expect(p).toContain('not_assessable')
    expect(p).toMatch(/non dare consigli di acquisto o vendita/i)
  })

  it('tells the model that ready needs the fundamentals and the VWAP', () => {
    const p = buildSystemPrompt()
    expect(p).toMatch(/oltre il 25%/)
    expect(p).toMatch(/avwap/i)
  })

  it('sends the input as JSON in the user prompt', () => {
    const input = passing()
    expect(buildUserPrompt(input)).toContain(JSON.stringify(input.vcp.status))
  })
})

describe('parseAiResult', () => {
  it('accepts a valid answer and keeps the model', () => {
    const r = parseAiResult(raw(), passing(), 'gemini-x')
    expect(r).toMatchObject({ verdict: 'ready', model: 'gemini-x', adjusted: false })
    expect(r?.criteria).toHaveLength(1)
  })

  it('rejects an answer that cites a rule that does not exist', () => {
    expect(parseAiResult(raw({ criteria: [{ ruleId: 'TT9', outcome: 'met', note: 'x' }] }), passing(), 'm')).toBeNull()
  })

  it.each([
    ['not an object', null],
    ['unknown verdict', raw({ verdict: 'buy' })],
    ['empty summary', raw({ summary: '  ' })],
    ['criteria not a list', raw({ criteria: 'TT1' })],
    ['unknown outcome', raw({ criteria: [{ ruleId: 'TT1', outcome: 'maybe', note: 'x' }] })],
  ])('rejects %s', (_name, bad) => {
    expect(parseAiResult(bad, passing(), 'm')).toBeNull()
  })

  it('lowers ready to wait when the Trend Template is not fully met, and says so', () => {
    const input = passing()
    input.trendTemplate.passedCount = input.trendTemplate.total - 1
    const r = parseAiResult(raw(), input, 'm')
    expect(r?.verdict).toBe('wait')
    expect(r?.adjusted).toBe(true)
  })

  it('lowers ready to wait when there is no base ready or breaking out', () => {
    const input = passing()
    input.vcp.status = 'extended'
    expect(parseAiResult(raw(), input, 'm')?.verdict).toBe('wait')
    input.vcp.status = null
    expect(parseAiResult(raw(), input, 'm')?.adjusted).toBe(true)
  })

  it('lowers ready to wait when the fundamentals fall short, and says so', () => {
    const input = passing()
    input.fundamentals = { epsGrowthQoq: 0.18, salesGrowthQoq: -13.85, roe: 12.51 }
    const r = parseAiResult(raw(), input, 'm')
    expect(r?.verdict).toBe('wait')
    expect(r?.adjusted).toBe(true)
  })

  it('does not hold unknown or passing fundamentals against a ready verdict', () => {
    const input = passing()
    input.fundamentals = null
    expect(parseAiResult(raw(), input, 'm')?.verdict).toBe('ready')
    input.fundamentals = { epsGrowthQoq: 40, salesGrowthQoq: null, roe: null }
    expect(parseAiResult(raw(), input, 'm')?.verdict).toBe('ready')
  })

  it('lowers ready to wait when the price is under the VWAP of the base', () => {
    const input = passing()
    input.avwap = input.price + 1
    expect(parseAiResult(raw(), input, 'm')).toMatchObject({ verdict: 'wait', adjusted: true })
    input.avwap = input.price
    expect(parseAiResult(raw(), input, 'm')?.verdict).toBe('ready')
  })

  it('does not touch wait or no', () => {
    const input = passing()
    input.trendTemplate.passedCount = 0
    expect(parseAiResult(raw({ verdict: 'no' }), input, 'm')).toMatchObject({ verdict: 'no', adjusted: false })
  })

  it('caps list lengths and text length', () => {
    const r = parseAiResult(raw({ summary: 'x'.repeat(900), risks: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], uncovered: [' '] }), passing(), 'm')
    expect(r?.summary.length).toBeLessThanOrEqual(500)
    expect(r?.risks).toHaveLength(5)
    expect(r?.uncovered).toEqual([])
  })
})

describe('parseAiResult duplicates and shape', () => {
  it('keeps one entry per rule when the model cites the same rule twice', () => {
    const dup = [
      { ruleId: 'TT1', outcome: 'met', note: 'prima' },
      { ruleId: 'TT1', outcome: 'not_met', note: 'seconda' },
      { ruleId: 'TT2', outcome: 'met', note: 'ok' },
    ]
    const r = parseAiResult(raw({ criteria: dup }), passing(), 'm')
    expect(r?.criteria.map((c) => c.ruleId)).toEqual(['TT1', 'TT2'])
    expect(r?.criteria[0].note).toBe('prima')
  })

  it('removes repeated list items', () => {
    const r = parseAiResult(raw({ risks: ['uguale', 'uguale', 'altro'] }), passing(), 'm')
    expect(r?.risks).toEqual(['uguale', 'altro'])
  })
})

describe('isAiResult', () => {
  it('accepts a parsed result and rejects other shapes', () => {
    const r = parseAiResult(raw(), passing(), 'm')
    expect(isAiResult(r)).toBe(true)
    expect(isAiResult(null)).toBe(false)
    expect(isAiResult({ ...r, verdict: 'buy' })).toBe(false)
    expect(isAiResult({ ...r, criteria: 'x' })).toBe(false)
    expect(isAiResult({ ...r, summary: 5 })).toBe(false)
  })
})

describe('parseAiResult ready guard', () => {
  it('does not keep ready when relative strength was never measured', () => {
    const input = passing()
    // Too few peers: criterion 8 is left out of the count, so passedCount equals total (7 of 7).
    input.trendTemplate.total = 7
    input.trendTemplate.passedCount = 7
    input.trendTemplate.criteria[7] = { ...input.trendTemplate.criteria[7], ok: false, value: 'non affidabile' }
    const r = parseAiResult(raw(), input, 'm')
    expect(r?.verdict).toBe('wait')
    expect(r?.adjusted).toBe(true)
  })

  it.each([
    ['a base deeper than 50%', { depthOk: false }],
    ['a base outside 5-26 weeks', { weeksOk: false }],
  ])('does not keep ready on %s', (_name, over) => {
    const input = passing()
    input.base = { ...goodBase, ...over }
    expect(parseAiResult(raw(), input, 'm')).toMatchObject({ verdict: 'wait', adjusted: true })
  })

  it('does not keep ready when there are no base metrics', () => {
    const input = passing()
    input.base = null
    expect(parseAiResult(raw(), input, 'm')?.verdict).toBe('wait')
  })
})

describe('generateAiResult', () => {
  it('does not start a second attempt when the first one already took too long', async () => {
    vi.useFakeTimers()
    try {
      const bad = { json: raw({ verdict: 'buy' }), model: 'm' }
      const slow = vi.fn(async () => {
        vi.advanceTimersByTime(40_000)
        return bad
      })
      expect(await generateAiResult(passing(), slow)).toBeNull()
      expect(slow).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  const ok = { json: raw(), model: 'gemini-x' }

  it('returns the parsed result on the first valid answer', async () => {
    const request = vi.fn().mockResolvedValue(ok)
    const r = await generateAiResult(passing(), request)
    expect(r?.verdict).toBe('ready')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toContain('TT1 [calcolo, confermata]')
  })

  it('tries once more when the first answer is invalid, then gives up', async () => {
    const bad = { json: raw({ criteria: [{ ruleId: 'XX1', outcome: 'met', note: '' }] }), model: 'm' }
    const retry = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(ok)
    expect((await generateAiResult(passing(), retry))?.verdict).toBe('ready')
    expect(retry).toHaveBeenCalledTimes(2)

    const always = vi.fn().mockResolvedValue(bad)
    expect(await generateAiResult(passing(), always)).toBeNull()
    expect(always).toHaveBeenCalledTimes(2)
  })

  it('returns null at once when the LLM is not configured or the call failed', async () => {
    const request = vi.fn().mockResolvedValue(null)
    expect(await generateAiResult(passing(), request)).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
  })
})
