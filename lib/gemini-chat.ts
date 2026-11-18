import { sseMessages } from '@/lib/sse'
import type { ChatTurn } from '@/lib/chat-request'

// The google_search tool is only documented on the native API, not on the OpenAI-compatible endpoint llm-news.ts uses.
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-3.8-flash'
const TIMEOUT_MS = 45_000

// 'quota' is Gemini refusing the project's quota; the app's own rate limit answers with an HTTP 429 before the stream starts.
export type ChatErrorCode = 'quota' | 'upstream' | 'timeout' | 'unavailable'

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'sources'; items: { title: string; url: string }[] }
  | { type: 'error'; code: ChatErrorCode }

interface GeminiChunk {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] }
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] }
  }[]
}

export function isChatConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY)
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError'
}

// Gemini reports the exhausted quota and the retry delay deep in error.details: keep them in the log even when the body is cut.
function describeFailure(body: string): string {
  const text = body.slice(0, 1000)
  try {
    const details = (JSON.parse(body) as { error?: { details?: Record<string, unknown>[] } }).error?.details ?? []
    const extra: string[] = []
    for (const detail of details) {
      const violations = detail.violations as { quotaMetric?: string; quotaId?: string }[] | undefined
      for (const v of violations ?? []) {
        if (v.quotaMetric) extra.push(`quotaMetric=${v.quotaMetric}`)
        if (v.quotaId) extra.push(`quotaId=${v.quotaId}`)
      }
      if (typeof detail.retryDelay === 'string') extra.push(`retryDelay=${detail.retryDelay}`)
    }
    return extra.length > 0 ? `${text} [${extra.join(' ')}]` : text
  } catch {
    return text
  }
}

export async function* streamChat({ system, history, signal }: { system: string; history: ChatTurn[]; signal?: AbortSignal }): AsyncGenerator<ChatEvent> {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    yield { type: 'error', code: 'unavailable' }
    return
  }
  const model = process.env.GEMINI_CHAT_MODEL || DEFAULT_MODEL
  const deadline = AbortSignal.timeout(TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        tools: [{ google_search: {} }],
      }),
      signal: combined,
    })
  } catch (err) {
    if (signal?.aborted) return
    console.error('Stock chat: Gemini stream failed:', err instanceof Error ? err.message : String(err))
    yield { type: 'error', code: isTimeout(err) ? 'timeout' : 'upstream' }
    return
  }
  if (!res.ok || !res.body) {
    console.error('Stock chat: Gemini request failed:', res.status, describeFailure(await res.text().catch(() => '')))
    yield { type: 'error', code: res.status === 429 ? 'quota' : 'upstream' }
    return
  }

  let sawText = false
  const sources = new Map<string, string>()
  try {
    for await (const message of sseMessages(res.body)) {
      let chunk: GeminiChunk
      try {
        chunk = JSON.parse(message.data) as GeminiChunk
      } catch {
        continue
      }
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.thought || !part.text) continue
          sawText = true
          yield { type: 'text', delta: part.text }
        }
        for (const g of candidate.groundingMetadata?.groundingChunks ?? []) {
          const uri = g.web?.uri
          // Only http(s) links: the URL ends up in an href.
          if (uri && /^https?:\/\//i.test(uri) && !sources.has(uri)) sources.set(uri, g.web?.title || uri)
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return
    console.error('Stock chat: Gemini stream failed:', err instanceof Error ? err.message : String(err))
    yield { type: 'error', code: isTimeout(err) ? 'timeout' : 'upstream' }
    return
  }
  if (!sawText) {
    yield { type: 'error', code: 'upstream' }
    return
  }
  if (sources.size > 0) yield { type: 'sources', items: [...sources].map(([url, title]) => ({ title, url })) }
}
