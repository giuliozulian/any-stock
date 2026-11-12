import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../helpers/db'
import * as llm from '@/lib/llm-news'
import * as youtube from '@/lib/youtube'
import { buildInsightInput, computeInputHash, generateInsight, parseInsight, refreshStockInsight } from '@/lib/stock-insight'

const valid = {
  summary: 'Conti solidi, video prudenti.',
  verdict: 'positive',
  score: 4,
  keyPoints: ['Ricavi oltre le attese'],
  risks: ['Valutazione elevata'],
  confidence: 'medium',
}
const stock = { symbol: 'NVDA', name: 'NVIDIA Corporation' }
const news = [{ headline: 'NVIDIA beats', source: 'Yahoo', publishedAt: new Date('2026-11-12T10:00:00Z'), summary: null }]
const videos = [{ id: 'a', title: 'NVDA analysis', channel: 'Chan', publishedAt: '2026-11-11T10:00:00Z', thumbnail: 't' }]

describe('parseInsight', () => {
  it('accepts a valid payload', () => {
    expect(parseInsight(valid, 'm')).toMatchObject({ verdict: 'positive', score: 4, model: 'm' })
  })
  it('truncates lists to 4 items', () => {
    const r = parseInsight({ ...valid, keyPoints: ['1', '2', '3', '4', '5', '6'] }, 'm')
    expect(r?.keyPoints).toEqual(['1', '2', '3', '4'])
  })
  it.each([
    { ...valid, verdict: 'up' },
    { ...valid, score: 9 },
    { ...valid, summary: '' },
    { ...valid, confidence: 'huge' },
    { ...valid, keyPoints: 'nope' },
    null,
  ])('rejects invalid payload %#', (bad) => {
    expect(parseInsight(bad, 'm')).toBeNull()
  })
})

describe('buildInsightInput', () => {
  it('limits news to 10 and videos to 6', () => {
    const manyNews = Array.from({ length: 15 }, (_, i) => ({ ...news[0], headline: `n${i}` }))
    const manyVideos = Array.from({ length: 9 }, (_, i) => ({ ...videos[0], id: `v${i}` }))
    const input = buildInsightInput(stock, manyNews, manyVideos)
    expect(input.news).toHaveLength(10)
    expect(input.videos).toHaveLength(6)
  })
})

describe('computeInputHash', () => {
  it('is stable for the same input and ignores video order', () => {
    const a = buildInsightInput(stock, news, [videos[0], { ...videos[0], title: 'Other' }])
    const b = buildInsightInput(stock, news, [{ ...videos[0], title: 'Other' }, videos[0]])
    expect(computeInputHash(a)).toBe(computeInputHash(b))
  })
  it('changes when a news item changes', () => {
    const a = buildInsightInput(stock, news, videos)
    const b = buildInsightInput(stock, [{ ...news[0], headline: 'Different' }], videos)
    expect(computeInputHash(a)).not.toBe(computeInputHash(b))
  })
})

describe('generateInsight', () => {
  beforeEach(() => {
    vi.stubEnv('LLM_API_KEY', 'test-token')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns a parsed insight from the LLM response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] }), { status: 200 }),
      ),
    )
    const r = await generateInsight(buildInsightInput(stock, news, videos))
    expect(r).toMatchObject({ verdict: 'positive', score: 4 })
  })

  it('returns null without a configured LLM and does not call the API', async () => {
    vi.stubEnv('LLM_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await generateInsight(buildInsightInput(stock, news, videos))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('refreshStockInsight', () => {
  let stockId: string

  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
    vi.stubEnv('LLM_API_KEY', 'test-token')
    const s = await prisma.stock.create({ data: { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' } })
    stockId = s.id
    vi.spyOn(youtube, 'getRecentVideos').mockResolvedValue([])
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function addNews(headline: string) {
    await prisma.newsItem.create({
      data: { stockId, headline, url: `https://x/${headline}`, source: 'Yahoo', publishedAt: new Date('2026-11-12T10:00:00Z') },
    })
  }

  it('skips when there is no news and no video', async () => {
    const spy = vi.spyOn(llm, 'requestLlmJson')
    expect(await refreshStockInsight(stockId)).toBe('skipped')
    expect(spy).not.toHaveBeenCalled()
  })

  it('stores the insight, then skips the LLM when inputs are unchanged', async () => {
    await addNews('NVIDIA beats')
    const spy = vi.spyOn(llm, 'requestLlmJson').mockResolvedValue({ json: valid, model: 'm' })

    expect(await refreshStockInsight(stockId)).toBe('updated')
    const saved = await prisma.stockInsight.findUniqueOrThrow({ where: { stockId } })
    expect(saved).toMatchObject({ verdict: 'positive', score: 4, keyPoints: ['Ricavi oltre le attese'] })

    expect(await refreshStockInsight(stockId)).toBe('unchanged')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('regenerates when a new news item arrives', async () => {
    await addNews('NVIDIA beats')
    const spy = vi.spyOn(llm, 'requestLlmJson').mockResolvedValue({ json: valid, model: 'm' })
    await refreshStockInsight(stockId)
    await addNews('NVIDIA new chip')
    expect(await refreshStockInsight(stockId)).toBe('updated')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('keeps the previous insight when the LLM answer is invalid', async () => {
    await addNews('NVIDIA beats')
    vi.spyOn(llm, 'requestLlmJson').mockResolvedValueOnce({ json: valid, model: 'm' })
    await refreshStockInsight(stockId)
    await addNews('NVIDIA new chip')
    vi.spyOn(llm, 'requestLlmJson').mockResolvedValueOnce({ json: { bad: true }, model: 'm' })
    expect(await refreshStockInsight(stockId)).toBe('failed')
    const saved = await prisma.stockInsight.findUniqueOrThrow({ where: { stockId } })
    expect(saved.summary).toBe(valid.summary)
  })
})
