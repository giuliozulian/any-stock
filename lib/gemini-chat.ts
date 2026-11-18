import { sseMessages } from '@/lib/sse'
import type { ChatTurn } from '@/lib/chat-request'

// The google_search tool is only documented on the native API, not on the OpenAI-compatible endpoint llm-news.ts uses.
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-3.8-flash'
const TIMEOUT_MS = 45_000

export type ChatErrorCode = 'rate_limited' | 'upstream' | 'timeout' | 'unavailable'

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
    console.error('Stock chat: Gemini request failed:', res.status, (await res.text().catch(() => '')).slice(0, 300))
    yield { type: 'error', code: res.status === 429 ? 'rate_limited' : 'upstream' }
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
