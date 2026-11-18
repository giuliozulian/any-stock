// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isChatConfigured, streamChat, type ChatEvent } from '@/lib/gemini-chat'

function sseResponse(payloads: unknown[], init: ResponseInit = { status: 200 }): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of payloads) c.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`))
      c.close()
    },
  })
  return new Response(body, init)
}

const textChunk = (text: string, extra: object = {}) => ({ candidates: [{ content: { parts: [{ text }] }, ...extra }] })

async function collect(gen: AsyncGenerator<ChatEvent>) {
  const out: ChatEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const args = { system: 'sys', history: [{ role: 'user' as const, text: 'ciao' }] }

describe('gemini-chat', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('GEMINI_API_KEY', 'k')
    vi.stubEnv('GEMINI_CHAT_MODEL', '')
  })
  afterEach(() => {
    errorSpy.mockRestore()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('is configured only with GEMINI_API_KEY', () => {
    expect(isChatConfigured()).toBe(true)
    vi.stubEnv('GEMINI_API_KEY', '')
    expect(isChatConfigured()).toBe(false)
  })

  it('reports unavailable without a key, without calling the network', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await collect(streamChat(args))).toEqual([{ type: 'error', code: 'unavailable' }])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends system instruction, turns and the google_search tool to the native API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([textChunk('ok')]))
    vi.stubGlobal('fetch', fetchMock)
    await collect(streamChat({ system: 'sys', history: [{ role: 'user', text: 'a' }, { role: 'model', text: 'b' }, { role: 'user', text: 'c' }] }))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse')
    expect(init.headers['x-goog-api-key']).toBe('k')
    expect(JSON.parse(init.body)).toEqual({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [
        { role: 'user', parts: [{ text: 'a' }] },
        { role: 'model', parts: [{ text: 'b' }] },
        { role: 'user', parts: [{ text: 'c' }] },
      ],
      tools: [{ google_search: {} }],
    })
  })

  it('uses GEMINI_CHAT_MODEL when set', async () => {
    vi.stubEnv('GEMINI_CHAT_MODEL', 'gemini-x')
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([textChunk('ok')]))
    vi.stubGlobal('fetch', fetchMock)
    await collect(streamChat(args))
    expect(fetchMock.mock.calls[0][0]).toContain('/models/gemini-x:streamGenerateContent')
  })

  it('emits text deltas, skips thought parts, then deduplicated sources', async () => {
    const web = (uri: string, title: string) => ({ web: { uri, title } })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          { candidates: [{ content: { parts: [{ text: 'pensiero', thought: true }, { text: 'Ciao ' }] } }] },
          textChunk('mondo', { groundingMetadata: { groundingChunks: [web('https://a.example/x', 'A'), web('https://a.example/x', 'A again')] } }),
          { candidates: [{ groundingMetadata: { groundingChunks: [web('https://b.example/y', 'B')] } }] },
        ]),
      ),
    )
    expect(await collect(streamChat(args))).toEqual([
      { type: 'text', delta: 'Ciao ' },
      { type: 'text', delta: 'mondo' },
      { type: 'sources', items: [{ title: 'A', url: 'https://a.example/x' }, { title: 'B', url: 'https://b.example/y' }] },
    ])
  })

  it('drops sources whose URL is not http(s)', async () => {
    const chunk = textChunk('x', { groundingMetadata: { groundingChunks: [{ web: { uri: 'javascript:alert(1)', title: 'bad' } }, { web: { uri: 'https://ok.example', title: 'ok' } }] } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([chunk])))
    const events = await collect(streamChat(args))
    expect(events[events.length - 1]).toEqual({ type: 'sources', items: [{ title: 'ok', url: 'https://ok.example' }] })
  })

  it('reports upstream when the stream ends without any text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([{ candidates: [{ finishReason: 'SAFETY' }] }])))
    expect(await collect(streamChat(args))).toEqual([{ type: 'error', code: 'upstream' }])
  })

  it('maps HTTP 429 to quota and other failures to upstream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })))
    expect(await collect(streamChat(args))).toEqual([{ type: 'error', code: 'quota' }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    expect(await collect(streamChat(args))).toEqual([{ type: 'error', code: 'upstream' }])
  })

  it('logs a non-OK response once with its status, never the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('quota exceeded', { status: 503 })))
    await collect(streamChat(args))
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith('Stock chat: Gemini request failed:', 503, 'quota exceeded')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('"k"')
  })

  it('keeps the exhausted quota and the retry delay in the log even when the body is long', async () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        message: 'x'.repeat(1500),
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '27s' },
        ],
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 429 })))
    await collect(streamChat(args))
    const logged = errorSpy.mock.calls[0][2] as string
    expect(logged).toContain('generate_content_free_tier_requests')
    expect(logged).toContain('GenerateRequestsPerDayPerProjectPerModel-FreeTier')
    expect(logged).toContain('retryDelay=27s')
    expect(logged.length).toBeLessThan(1400)
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('"k"')
  })

  it('logs a fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('dns down')))
    await collect(streamChat(args))
    expect(errorSpy).toHaveBeenCalledWith('Stock chat: Gemini stream failed:', 'dns down')
  })

  it('does not log when the caller aborts', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    }))
    await collect(streamChat({ ...args, signal: controller.signal }))
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('reports an error after partial text when the network drops mid-stream', async () => {
    const enc = new TextEncoder()
    // error() would discard queued chunks, so fail on the read that follows the first chunk.
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent) return c.error(new Error('socket hang up'))
        sent = true
        c.enqueue(enc.encode(`data: ${JSON.stringify(textChunk('par'))}\n\n`))
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    expect(await collect(streamChat(args))).toEqual([{ type: 'text', delta: 'par' }, { type: 'error', code: 'upstream' }])
  })

  it('stays silent when the caller aborts', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      controller.abort()
      throw init.signal?.reason ?? new DOMException('aborted', 'AbortError')
    }))
    expect(await collect(streamChat({ ...args, signal: controller.signal }))).toEqual([])
  })

  it('reports timeout when the deadline fires', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')))
    expect(await collect(streamChat(args))).toEqual([{ type: 'error', code: 'timeout' }])
  })
})
