// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { sseMessages } from '@/lib/sse'

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

async function collect(body: ReadableStream<Uint8Array>) {
  const out = []
  for await (const m of sseMessages(body)) out.push(m)
  return out
}

describe('sseMessages', () => {
  it('parses event and data', async () => {
    expect(await collect(streamOf('event: text\ndata: {"a":1}\n\n'))).toEqual([{ event: 'text', data: '{"a":1}' }])
  })

  it('defaults the event name to message', async () => {
    expect(await collect(streamOf('data: hi\n\n'))).toEqual([{ event: 'message', data: 'hi' }])
  })

  it('handles a message split across chunks, even in the middle of a line', async () => {
    expect(await collect(streamOf('event: te', 'xt\ndata: {"a"', ':1}\n', '\nevent: x\ndata: 2\n\n'))).toEqual([
      { event: 'text', data: '{"a":1}' },
      { event: 'x', data: '2' },
    ])
  })

  it('handles CRLF, even when \\r and \\n arrive in different chunks', async () => {
    expect(await collect(streamOf('data: a\r', '\n\r\ndata: b\r\n\r\n'))).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
    ])
  })

  it('joins multi-line data and ignores comments', async () => {
    expect(await collect(streamOf(': keepalive\n\ndata: one\ndata: two\n\n'))).toEqual([{ event: 'message', data: 'one\ntwo' }])
  })

  it('emits a final message that lacks the closing blank line', async () => {
    expect(await collect(streamOf('data: tail'))).toEqual([{ event: 'message', data: 'tail' }])
  })

  it('keeps multi-byte characters split across chunks intact', async () => {
    const bytes = new TextEncoder().encode('data: è\n\n')
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 7))
        c.enqueue(bytes.slice(7))
        c.close()
      },
    })
    expect(await collect(body)).toEqual([{ event: 'message', data: 'è' }])
  })
})
