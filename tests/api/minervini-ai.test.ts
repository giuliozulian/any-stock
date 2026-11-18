import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { POST } from '@/app/api/minervini-ai/[symbol]/route'
import type { Bar } from '@/lib/history'
import { detectVcp, evaluateTrendTemplate } from '@/lib/minervini'

const DAY = 86_400_000
const bars: Bar[] = Array.from({ length: 300 }, (_, i) => {
  const close = 100 + i * 0.5
  return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
})

const analysis = { template: evaluateTrendTemplate(bars, 80)!, vcp: detectVcp(bars), peerCount: 12 }
const llmAnswer = {
  verdict: 'wait',
  summary: 'Trend soddisfatto, base ancora da completare.',
  criteria: [{ ruleId: 'TT1', outcome: 'met', note: 'ok' }],
  missing: ['Contrazione finale'],
  risks: [],
  uncovered: [],
}

const getMinerviniAnalysis = vi.fn()
const requestLlmJson = vi.fn()
const isLlmConfigured = vi.fn()
const rateLimit = vi.fn()

vi.mock('@/lib/minervini-data', () => ({ getMinerviniAnalysis: (s: string) => getMinerviniAnalysis(s) }))
vi.mock('@/lib/llm-news', () => ({ requestLlmJson: (...a: unknown[]) => requestLlmJson(...a), isLlmConfigured: () => isLlmConfigured() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (b: string) => rateLimit(b) }))

const call = (symbol: string) => POST(new Request(`http://localhost/api/minervini-ai/${symbol}`, { method: 'POST' }), { params: Promise.resolve({ symbol }) })

describe('POST /api/minervini-ai/[symbol]', () => {
  beforeEach(async () => {
    await resetDb()
    vi.clearAllMocks()
    getMinerviniAnalysis.mockResolvedValue(analysis)
    requestLlmJson.mockResolvedValue({ json: llmAnswer, model: 'gemini-x' })
    isLlmConfigured.mockReturnValue(true)
    rateLimit.mockResolvedValue(null)
  })

  it('generates, stores and returns the analysis', async () => {
    const res = await call('aapl')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cached).toBe(false)
    expect(body.result.verdict).toBe('wait')
    expect(await prisma.minerviniAiNote.count()).toBe(1)
    expect(getMinerviniAnalysis).toHaveBeenCalledWith('AAPL')
  })

  it('serves a second identical request from the cache without calling the LLM', async () => {
    await call('AAPL')
    const res = await call('AAPL')
    expect((await res.json()).cached).toBe(true)
    expect(requestLlmJson).toHaveBeenCalledTimes(1)
    expect(await prisma.minerviniAiNote.count()).toBe(1)
  })

  it('regenerates once when the numbers changed in the same day', async () => {
    await call('AAPL')
    getMinerviniAnalysis.mockResolvedValue({ ...analysis, peerCount: 30 })
    const res = await call('AAPL')
    expect((await res.json()).cached).toBe(false)
    expect(requestLlmJson).toHaveBeenCalledTimes(2)
    expect(await prisma.minerviniAiNote.count()).toBe(1)
  })

  it('answers 503 when the LLM is not configured, the history is too short or the answer is invalid', async () => {
    isLlmConfigured.mockReturnValue(false)
    expect((await call('AAPL')).status).toBe(503)

    isLlmConfigured.mockReturnValue(true)
    getMinerviniAnalysis.mockResolvedValue(null)
    expect((await call('AAPL')).status).toBe(503)

    getMinerviniAnalysis.mockResolvedValue(analysis)
    requestLlmJson.mockResolvedValue({ json: { verdict: 'buy' }, model: 'm' })
    expect((await call('AAPL')).status).toBe(503)
    expect(await prisma.minerviniAiNote.count()).toBe(0)
  })

  it('refuses a malformed symbol', async () => {
    for (const bad of ['', '../x', 'A'.repeat(20), 'AA PL']) expect((await call(bad)).status).toBe(400)
    expect(getMinerviniAnalysis).not.toHaveBeenCalled()
  })

  it('returns the rate limit response as is', async () => {
    rateLimit.mockResolvedValue(new Response('slow down', { status: 429 }))
    expect((await call('AAPL')).status).toBe(429)
    expect(requestLlmJson).not.toHaveBeenCalled()
  })

  it('regenerates at most once a day: a second change of the numbers is served from the stored row', async () => {
    await call('AAPL')
    getMinerviniAnalysis.mockResolvedValue({ ...analysis, peerCount: 30 })
    await call('AAPL')
    getMinerviniAnalysis.mockResolvedValue({ ...analysis, peerCount: 40 })
    const res = await call('AAPL')
    expect((await res.json()).cached).toBe(true)
    expect(requestLlmJson).toHaveBeenCalledTimes(2)
  })

  it('treats a stored row with an unknown shape as missing', async () => {
    const day = new Date().toISOString().slice(0, 10)
    const { buildInput, computeHash } = await import('@/lib/minervini-ai')
    const inputHash = computeHash(buildInput('AAPL', analysis))
    await prisma.minerviniAiNote.create({ data: { symbol: 'AAPL', day, inputHash, result: { verdict: 'buy' }, model: 'm', promptVersion: 1 } })
    const res = await call('AAPL')
    expect(res.status).toBe(200)
    expect((await res.json()).cached).toBe(false)
    expect(requestLlmJson).toHaveBeenCalledTimes(1)
  })

  it('pays for one LLM call when two identical requests arrive together', async () => {
    requestLlmJson.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ json: llmAnswer, model: 'gemini-x' }), 20)))
    const [a, b] = await Promise.all([call('AAPL'), call('AAPL')])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(requestLlmJson).toHaveBeenCalledTimes(1)
    expect(await prisma.minerviniAiNote.count()).toBe(1)
  })

  it('answers with the stored row when another instance saved it first (unique violation)', async () => {
    const real = prisma.minerviniAiNote.upsert.bind(prisma.minerviniAiNote)
    vi.spyOn(prisma.minerviniAiNote, 'upsert').mockImplementationOnce((async (args: Parameters<typeof real>[0]) => {
      await real(args)
      throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' })
    }) as never)
    const res = await call('AAPL')
    expect(res.status).toBe(200)
    expect((await res.json()).result.verdict).toBe('wait')
    vi.restoreAllMocks()
  })

  it('still answers when cleaning up old rows fails', async () => {
    vi.spyOn(prisma.minerviniAiNote, 'deleteMany').mockRejectedValueOnce(new Error('boom'))
    const res = await call('AAPL')
    expect(res.status).toBe(200)
    vi.restoreAllMocks()
  })

  it('answers 503 when something throws', async () => {
    getMinerviniAnalysis.mockRejectedValue(new Error('yahoo down'))
    expect((await call('AAPL')).status).toBe(503)
  })
})
