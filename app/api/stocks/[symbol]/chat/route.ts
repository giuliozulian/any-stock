import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { currentUserId, findEntry } from '@/lib/watchlist'
import { parseChatRequest } from '@/lib/chat-request'
import { isChatConfigured, streamChat } from '@/lib/gemini-chat'
import { loadStockChatInput } from '@/lib/stock-chat-data'
import { buildStockContext, SYSTEM_PROMPT } from '@/lib/stock-chat-context'

export const maxDuration = 60

const encoder = new TextEncoder()
const sse = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

export async function POST(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  if (!isChatConfigured()) return NextResponse.json({ error: 'Chat not configured' }, { status: 503 })
  const limited = await rateLimit('heavy')
  if (limited) return limited

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = parseChatRequest(json)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()
  const entry = await findEntry(await currentUserId(), symbol)
  if (!entry) return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })

  const system = `${SYSTEM_PROMPT}\n\n--- CONTESTO DEL TITOLO ---\n${buildStockContext(await loadStockChatInput(entry))}`

  const abort = new AbortController()
  request.signal.addEventListener('abort', () => abort.abort())
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamChat({ system, history: parsed.history, signal: abort.signal })) {
          if (abort.signal.aborted) break
          controller.enqueue(sse(event.type, event))
        }
      } catch {
        if (!abort.signal.aborted) controller.enqueue(sse('error', { type: 'error', code: 'upstream' }))
      }
      if (!abort.signal.aborted) controller.close()
    },
    cancel() {
      abort.abort()
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' },
  })
}
