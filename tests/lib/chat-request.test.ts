import { describe, it, expect } from 'vitest'
import { parseChatRequest, MAX_CHARS, MAX_MESSAGES, MAX_MODEL_CHARS } from '@/lib/chat-request'

const u = (text: string) => ({ role: 'user', text })
const m = (text: string) => ({ role: 'model', text })

describe('parseChatRequest', () => {
  it('accepts a single user message and trims it', () => {
    expect(parseChatRequest({ messages: [u('  ciao  ')] })).toEqual({ ok: true, history: [{ role: 'user', text: 'ciao' }] })
  })

  it('accepts alternating turns ending with a user message', () => {
    const r = parseChatRequest({ messages: [u('a'), m('b'), u('c')] })
    expect(r.ok).toBe(true)
  })

  it.each([
    ['non-object body', null],
    ['missing messages', {}],
    ['messages not an array', { messages: 'x' }],
    ['empty list', { messages: [] }],
    ['whitespace-only text', { messages: [u('   ')] }],
    ['non-string text', { messages: [{ role: 'user', text: 5 }] }],
    ['unknown role', { messages: [{ role: 'system', text: 'x' }] }],
    ['starts with model', { messages: [m('x'), u('y')] }],
    ['ends with model', { messages: [u('x'), m('y')] }],
    ['two user messages in a row', { messages: [u('x'), u('y')] }],
    ['user text over the limit', { messages: [u('x'.repeat(MAX_CHARS + 1))] }],
    ['too many messages', { messages: Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => (i % 2 === 0 ? u('x') : m('y'))) }],
  ])('rejects %s', (_name, body) => {
    expect(parseChatRequest(body).ok).toBe(false)
  })

  it('keeps long model turns instead of rejecting them', () => {
    const r = parseChatRequest({ messages: [u('a'), m('y'.repeat(3000)), u('c')] })
    expect(r.ok && r.history[1].text.length).toBe(3000)
  })

  it('truncates model turns over MAX_MODEL_CHARS', () => {
    const r = parseChatRequest({ messages: [u('a'), m('y'.repeat(9000)), u('c')] })
    expect(MAX_MODEL_CHARS).toBe(8000)
    expect(r.ok && r.history[1].text.length).toBe(MAX_MODEL_CHARS)
  })

  it('accepts exactly the limits', () => {
    // 19 alternating messages: user first and last, the longest conversation that can still end with the user.
    const messages = Array.from({ length: MAX_MESSAGES - 1 }, (_, i) => (i % 2 === 0 ? u('x') : m('y')))
    messages[messages.length - 1] = u('x'.repeat(MAX_CHARS))
    expect(parseChatRequest({ messages }).ok).toBe(true)
  })
})
