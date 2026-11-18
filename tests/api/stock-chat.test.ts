import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetDb, watch } from '../helpers/db'

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => null as Response | null),
  isChatConfigured: vi.fn(() => true),
  streamChat: vi.fn(),
  loadStockChatInput: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }))
vi.mock('@/lib/gemini-chat', () => ({ isChatConfigured: mocks.isChatConfigured, streamChat: mocks.streamChat }))
vi.mock('@/lib/stock-chat-data', () => ({ loadStockChatInput: mocks.loadStockChatInput }))

import { POST } from '@/app/api/stocks/[symbol]/chat/route'

const input = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', snapshot: null, evaluation: null, minervini: null, earnings: { date: null, hour: null, epsEstimate: null }, news: [], insiders: null, congress: null }

function call(symbol: string, body: unknown) {
  const request = new Request('http://localhost/api/stocks/x/chat', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
  return POST(request as never, { params: Promise.resolve({ symbol }) })
}
const ask = (text = 'Come va?') => ({ messages: [{ role: 'user', text }] })

describe('POST /api/stocks/[symbol]/chat', () => {
  beforeEach(async () => {
    await resetDb()
    vi.clearAllMocks()
    mocks.rateLimit.mockResolvedValue(null)
    mocks.isChatConfigured.mockReturnValue(true)
    mocks.loadStockChatInput.mockResolvedValue(input)
    mocks.streamChat.mockImplementation(async function* () {
      yield { type: 'text', delta: 'Ciao' }
      yield { type: 'sources', items: [{ title: 'A', url: 'https://a.example' }] }
    })
  })

  it('returns 503 when the chat is not configured', async () => {
    mocks.isChatConfigured.mockReturnValue(false)
    expect((await call('AAPL', ask())).status).toBe(503)
  })

  it('returns the rate limit response when over the limit', async () => {
    mocks.rateLimit.mockResolvedValue(Response.json({ error: 'Too many requests' }, { status: 429 }))
    expect((await call('AAPL', ask())).status).toBe(429)
    expect(mocks.streamChat).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON and for an invalid conversation', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    expect((await call('AAPL', '{not json')).status).toBe(400)
    expect((await call('AAPL', { messages: [] })).status).toBe(400)
    expect((await call('AAPL', { messages: [{ role: 'user', text: '   ' }] })).status).toBe(400)
  })

  it('returns 404 for a stock that is not in the watchlist', async () => {
    expect((await call('NOPE', ask())).status).toBe(404)
    expect(mocks.streamChat).not.toHaveBeenCalled()
  })

  it('streams the events as SSE and passes context and history to the model', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    const res = await call('aapl', ask('Perché è sceso?'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = await res.text()
    expect(body).toContain('event: text\ndata: {"type":"text","delta":"Ciao"}\n\n')
    expect(body).toContain('event: sources\ndata: {"type":"sources","items":[{"title":"A","url":"https://a.example"}]}\n\n')
    const args = mocks.streamChat.mock.calls[0][0]
    expect(args.history).toEqual([{ role: 'user', text: 'Perché è sceso?' }])
    expect(args.system).toContain('Apple Inc. (NASDAQ: AAPL)')
    expect(args.system).toContain('italiano')
  })

  it('accepts a long model turn in the history', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    const long = 'y'.repeat(3000)
    const res = await call('AAPL', { messages: [{ role: 'user', text: 'a' }, { role: 'model', text: long }, { role: 'user', text: 'b' }] })
    expect(res.status).toBe(200)
    await res.text()
    expect(mocks.streamChat.mock.calls[0][0].history[1]).toEqual({ role: 'model', text: long })
  })

  it('forwards a model error event and still closes the stream', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    mocks.streamChat.mockImplementation(async function* () {
      yield { type: 'error', code: 'upstream' }
    })
    expect(await (await call('AAPL', ask())).text()).toContain('event: error\ndata: {"type":"error","code":"upstream"}')
  })

  it('reports upstream when the model client throws', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    // eslint-disable-next-line require-yield
    mocks.streamChat.mockImplementation(async function* () {
      throw new Error('boom')
    })
    expect(await (await call('AAPL', ask())).text()).toContain('"code":"upstream"')
  })

  it('aborts the model call when the client disconnects', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    let seen: AbortSignal | undefined
    mocks.streamChat.mockImplementation(async function* ({ signal }: { signal: AbortSignal }) {
      seen = signal
      yield { type: 'text', delta: 'a' }
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
    })
    const res = await call('AAPL', ask())
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()
    await vi.waitFor(() => expect(seen?.aborted).toBe(true))
  })
})
