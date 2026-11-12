import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeNewsWithLlm, parseLlmAnalysis } from '@/lib/llm-news'
import { evaluateNewsImpact } from '@/lib/evaluate'

const valid = { direction: 'positive', intensity: 4, horizon: 'short', scope: 'direct', confidence: 'high', rationale: 'Conti oltre le attese.' }
const ctx = {
  stock: { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  news: { headline: 'NVIDIA beats estimates', summary: null, source: 'Yahoo', publishedAt: new Date('2026-11-12') },
}

describe('parseLlmAnalysis', () => {
  it('accepts a valid payload', () => {
    expect(parseLlmAnalysis(valid, 'm')).toMatchObject({ direction: 'positive', intensity: 4, model: 'm' })
  })
  it.each([
    { ...valid, direction: 'up' },
    { ...valid, intensity: 9 },
    { ...valid, rationale: '' },
    null,
  ])('rejects invalid payload %#', (bad) => {
    expect(parseLlmAnalysis(bad, 'm')).toBeNull()
  })
})

describe('analyzeNewsWithLlm', () => {
  beforeEach(() => {
    vi.stubEnv('LLM_API_KEY', 'test-token')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns null without a token and does not call the API', async () => {
    vi.stubEnv('LLM_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await analyzeNewsWithLlm(ctx)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('parses the model response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] }) }))
    expect(await analyzeNewsWithLlm(ctx)).toMatchObject({ direction: 'positive', confidence: 'high' })
  })

  it('returns null on malformed JSON and throws on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'non json' } }] }) }))
    expect(await analyzeNewsWithLlm(ctx)).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    await expect(analyzeNewsWithLlm(ctx)).rejects.toThrow('429')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/plain' }), text: async () => 'OK' }))
    await expect(analyzeNewsWithLlm(ctx)).rejects.toThrow('non JSON')
  })
})

describe('evaluateNewsImpact', () => {
  const now = new Date('2026-11-12T12:00:00Z')
  const base = { latestSnapshot: {} as never, earliestSnapshot: null, recentRecommendations: [], now }
  const a = (direction: string, over = {}) => ({ direction, intensity: 4, confidence: 'high', publishedAt: new Date('2026-11-11T12:00:00Z'), ...over })

  it('adds +1 when the net of strong recent news is >= 2', () => {
    expect(evaluateNewsImpact({ ...base, newsAnalyses: [a('positive'), a('positive'), a('negative')] }).adjustment).toBe(0)
    expect(evaluateNewsImpact({ ...base, newsAnalyses: [a('positive'), a('positive')] }).adjustment).toBe(1)
    expect(evaluateNewsImpact({ ...base, newsAnalyses: [a('negative'), a('negative')] }).adjustment).toBe(-1)
  })

  it('ignores low confidence, low intensity and old news', () => {
    const res = evaluateNewsImpact({
      ...base,
      newsAnalyses: [a('positive', { confidence: 'medium' }), a('positive', { intensity: 2 }), a('positive', { publishedAt: new Date('2026-10-01') })],
    })
    expect(res).toMatchObject({ counted: 0, adjustment: 0 })
  })
})
