import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScanButton } from '@/components/ScanButton'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

describe('ScanButton', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('calls POST /api/discover when clicked and shows a loading state', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    ;(fetch as any).mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))

    render(<ScanButton />)
    const button = screen.getByRole('button', { name: /scansiona ora/i })
    fireEvent.click(button)

    expect(button).toBeDisabled()
    expect(fetch).toHaveBeenCalledWith('/api/discover', expect.objectContaining({ method: 'POST', headers: { Accept: 'application/x-ndjson' } }))

    resolveFetch({ ok: true, json: () => Promise.resolve({ scannedAt: '2026-11-13T10:00:00Z', candidates: 2 }) })
    await waitFor(() => expect(screen.getByRole('button', { name: /scansiona ora/i })).not.toBeDisabled())
  })

  it('shows an error message when the scan fails', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Discovery scan failed' }) })

    render(<ScanButton />)
    fireEvent.click(screen.getByRole('button', { name: /scansiona ora/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Discovery scan failed')
  })

  it('shows the step and the counter while the scan streams its progress', async () => {
    const encoder = new TextEncoder()
    let push: (line: string) => void = () => {}
    let close: () => void = () => {}
    const body = new ReadableStream({
      start(controller) {
        push = (line) => controller.enqueue(encoder.encode(`${line}\n`))
        close = () => controller.close()
      },
    })
    ;(fetch as any).mockResolvedValue({ ok: true, body })

    render(<ScanButton />)
    fireEvent.click(screen.getByRole('button', { name: /scansiona ora/i }))
    push(JSON.stringify({ step: 'Leggo conti, insider e prezzi', done: 3, total: 20 }))

    expect(await screen.findByRole('status')).toHaveTextContent('Leggo conti, insider e prezzi (3/20)')
    push(JSON.stringify({ result: { candidates: 2 } }))
    close()
    await waitFor(() => expect(screen.getByRole('button', { name: /scansiona ora/i })).not.toBeDisabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the error line sent by the stream', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ error: 'Discovery scan failed' })}\n`))
        controller.close()
      },
    })
    ;(fetch as any).mockResolvedValue({ ok: true, body })

    render(<ScanButton />)
    fireEvent.click(screen.getByRole('button', { name: /scansiona ora/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Discovery scan failed')
  })
})
