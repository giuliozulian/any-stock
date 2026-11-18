export type ChatTurn = { role: 'user' | 'model'; text: string }

export const MAX_MESSAGES = 20
export const MAX_CHARS = 2000

export type ParsedChat = { ok: true; history: ChatTurn[] } | { ok: false; error: string }

// Turns must start with the user, alternate, and end with the user: the Gemini API expects that shape.
export function parseChatRequest(json: unknown): ParsedChat {
  const messages = (json as { messages?: unknown } | null)?.messages
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, error: 'messages required' }
  if (messages.length > MAX_MESSAGES) return { ok: false, error: `at most ${MAX_MESSAGES} messages` }
  const history: ChatTurn[] = []
  for (const [i, raw] of messages.entries()) {
    const role = (raw as { role?: unknown } | null)?.role
    const text = (raw as { text?: unknown } | null)?.text
    if (role !== 'user' && role !== 'model') return { ok: false, error: 'invalid role' }
    if (role !== (i % 2 === 0 ? 'user' : 'model')) return { ok: false, error: 'turns must alternate, starting with the user' }
    if (typeof text !== 'string') return { ok: false, error: 'invalid text' }
    const trimmed = text.trim()
    if (trimmed.length === 0) return { ok: false, error: 'empty message' }
    if (trimmed.length > MAX_CHARS) return { ok: false, error: `message over ${MAX_CHARS} characters` }
    history.push({ role, text: trimmed })
  }
  if (history[history.length - 1].role !== 'user') return { ok: false, error: 'last message must be from the user' }
  return { ok: true, history }
}
