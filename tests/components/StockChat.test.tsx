import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StockChat } from '@/components/StockChat'

const enc = new TextEncoder()

const frame = (e: { event: string; data: unknown }) => enc.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)

// A finished stream, a stream that breaks after its events (error() would drop queued chunks, so it fails on the next read),
// or a stream that stays open until the request is aborted, like a real fetch body.
function sseBody(events: { event: string; data: unknown }[], opts: { hangUntil?: AbortSignal; fail?: boolean } = {}): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(c) {
      if (i < events.length) return c.enqueue(frame(events[i++]))
      if (opts.fail) return c.error(new Error('network down'))
      if (opts.hangUntil) {
        return new Promise<void>((resolve) => {
          opts.hangUntil!.addEventListener('abort', () => {
            c.error(new DOMException('aborted', 'AbortError'))
            resolve()
          })
        })
      }
      c.close()
    },
  })
}

const ok = (events: { event: string; data: unknown }[], opts = {}) => ({ ok: true, status: 200, body: sseBody(events, opts) })
const hanging = (events: { event: string; data: unknown }[]) => (_url: string, init: RequestInit) => Promise.resolve(ok(events, { hangUntil: init.signal as AbortSignal }))
const text = (delta: string) => ({ event: 'text', data: { type: 'text', delta } })

function open() {
  render(<StockChat symbol="AAPL" name="Apple Inc." />)
  fireEvent.click(screen.getByRole('button', { name: /chiedi all.ia/i }))
  return screen.getByRole('textbox')
}

function sentBody(call: number) {
  return JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[call][1].body)
}

describe('StockChat', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows only the launcher until opened, then a dialog with suggestions and the disclaimer', () => {
    render(<StockChat symbol="AAPL" name="Apple Inc." />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /chiedi all.ia/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /perché si è mosso oggi/i })).toBeInTheDocument()
    expect(screen.getByText(/non è consulenza finanziaria/i)).toBeInTheDocument()
  })

  it('streams the answer and shows http sources as safe links', async () => {
    ;(fetch as any).mockResolvedValue(
      ok([text('Ciao '), text('mondo'), { event: 'sources', data: { type: 'sources', items: [{ title: 'Reuters', url: 'https://r.example/a' }, { title: 'Bad', url: 'javascript:alert(1)' }] } }]),
    )
    const box = open()
    fireEvent.change(box, { target: { value: 'Come va?' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(await screen.findByText('Ciao mondo')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/stocks/AAPL/chat', expect.objectContaining({ method: 'POST' }))
    expect(sentBody(0)).toEqual({ messages: [{ role: 'user', text: 'Come va?' }] })
    const link = await screen.findByRole('link', { name: 'Reuters' })
    expect(link).toHaveAttribute('href', 'https://r.example/a')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByRole('link', { name: 'Bad' })).toBeNull()
  })

  it('sends a suggested question when clicked', async () => {
    ;(fetch as any).mockResolvedValue(ok([text('ok')]))
    open()
    fireEvent.click(screen.getByRole('button', { name: /quali sono i rischi principali/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(sentBody(0).messages[0].text).toMatch(/rischi principali/i)
  })

  it('does not send on Shift+Enter, nor an empty message', () => {
    const box = open()
    fireEvent.change(box, { target: { value: 'riga uno' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    fireEvent.change(box, { target: { value: '   ' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores a second send while an answer is streaming, and stops on "Interrompi"', async () => {
    ;(fetch as any).mockImplementation(hanging([text('parziale')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'uno' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('parziale')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'due' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(fetch).toHaveBeenCalledTimes(1)

    const signal = (fetch as any).mock.calls[0][1].signal as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: /interrompi/i }))
    expect(signal.aborted).toBe(true)
    await waitFor(() => expect(screen.queryByRole('button', { name: /interrompi/i })).toBeNull())
    expect(screen.getByText('parziale')).toBeInTheDocument()
    expect(screen.queryByText(/qualcosa è andato storto|riprova/i)).toBeNull()
  })

  it('shows the error for the status code and retries the same question', async () => {
    ;(fetch as any).mockResolvedValueOnce({ ok: false, status: 429, body: null }).mockResolvedValueOnce(ok([text('risposta')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'domanda' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText(/troppe richieste/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /riprova/i }))
    expect(await screen.findByText('risposta')).toBeInTheDocument()
    expect(sentBody(1)).toEqual({ messages: [{ role: 'user', text: 'domanda' }] })
  })

  it('keeps partial text when the stream breaks, and leaves the failed turn out of the next request', async () => {
    ;(fetch as any).mockResolvedValueOnce(ok([text('metà')], { fail: true })).mockResolvedValueOnce(ok([text('ok')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'prima' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('metà')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /riprova/i })).toBeInTheDocument()

    fireEvent.change(box, { target: { value: 'seconda' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(sentBody(1)).toEqual({ messages: [{ role: 'user', text: 'seconda' }] })
  })

  it('sends the whole conversation on the second question', async () => {
    ;(fetch as any).mockResolvedValueOnce(ok([text('r1')])).mockResolvedValueOnce(ok([text('r2')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'q1' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('r1')
    await waitFor(() => expect(screen.queryByRole('button', { name: /interrompi/i })).toBeNull())
    fireEvent.change(box, { target: { value: 'q2' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('r2')
    expect(sentBody(1).messages).toEqual([
      { role: 'user', text: 'q1' },
      { role: 'model', text: 'r1' },
      { role: 'user', text: 'q2' },
    ])
  })

  it('"Nuova chat" clears the conversation', async () => {
    ;(fetch as any).mockResolvedValue(ok([text('r1')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'q1' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('r1')
    fireEvent.click(screen.getByRole('button', { name: /nuova chat/i }))
    expect(screen.queryByText('r1')).toBeNull()
    expect(screen.getByRole('button', { name: /perché si è mosso oggi/i })).toBeInTheDocument()
  })

  it('closes on Escape and gives the focus back to the launcher', () => {
    open()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /chiedi all.ia/i })).toHaveFocus()
  })

  it('gives the focus back to the input once the answer is complete', async () => {
    ;(fetch as any).mockResolvedValue(ok([text('fatto')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'q' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    box.blur() // browsers drop the focus when a focused textarea becomes disabled; jsdom does not
    await screen.findByText('fatto')
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus())
  })

  it('shows a waiting line until the first token, and drops it on "Interrompi"', async () => {
    ;(fetch as any).mockImplementation(hanging([]))
    const box = open()
    fireEvent.change(box, { target: { value: 'q' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('Sto cercando…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /interrompi/i }))
    await waitFor(() => expect(screen.queryByText('Sto cercando…')).toBeNull())
  })

  it('reports an error when the stream closes without any event', async () => {
    ;(fetch as any).mockResolvedValue(ok([]))
    const box = open()
    fireEvent.change(box, { target: { value: 'q' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText(/il servizio non ha risposto/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /riprova/i })).toBeInTheDocument()
  })

  it('asks to reload on 401, without a retry button', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, status: 401, body: null })
    const box = open()
    fireEvent.change(box, { target: { value: 'q' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText(/sessione scaduta: ricarica la pagina/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /riprova/i })).toBeNull()
  })

  it('shows the unavailable message on 404', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, status: 404, body: null })
    const box = open()
    fireEvent.change(box, { target: { value: 'q' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText(/la chat non è disponibile/i)).toBeInTheDocument()
  })

  it('falls back to the upstream message for an unknown error code', async () => {
    ;(fetch as any).mockResolvedValue(ok([{ event: 'error', data: { type: 'error', code: 'weird' } }]))
    const box = open()
    fireEvent.change(box, { target: { value: 'q' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText(/il servizio non ha risposto/i)).toBeInTheDocument()
  })

  it('marks the message list busy only while streaming', async () => {
    ;(fetch as any).mockImplementation(hanging([text('x')]))
    const box = open()
    const list = screen.getByRole('dialog').querySelector('[aria-live="polite"]')!
    expect(list).toHaveAttribute('aria-busy', 'false')
    fireEvent.change(box, { target: { value: 'q' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('x')
    expect(list).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(screen.getByRole('button', { name: /interrompi/i }))
    await waitFor(() => expect(list).toHaveAttribute('aria-busy', 'false'))
  })

  it('a late finish of a reset stream does not clobber the new one', async () => {
    ;(fetch as any).mockImplementation(hanging([text('vecchio')]))
    const box = open()
    fireEvent.change(box, { target: { value: 'uno' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('vecchio')
    fireEvent.click(screen.getByRole('button', { name: /nuova chat/i }))
    fireEvent.change(box, { target: { value: 'due' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(fetch).toHaveBeenCalledTimes(2)
    // let the aborted first request settle
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByRole('button', { name: /interrompi/i })).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'tre' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('aborts a running answer when the page is left', async () => {
    ;(fetch as any).mockImplementation(hanging([text('x')]))
    const { unmount } = render(<StockChat symbol="AAPL" name="Apple Inc." />)
    fireEvent.click(screen.getByRole('button', { name: /chiedi all.ia/i }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await screen.findByText('x')
    const signal = (fetch as any).mock.calls[0][1].signal as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
