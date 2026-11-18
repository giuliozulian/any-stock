import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScannerButton } from '@/components/ScannerButton'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })

describe('ScannerButton', () => {
  beforeEach(() => {
    refresh.mockClear()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('starts the scan, steps until it is done, shows progress and refreshes the page', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce(ok({ runId: 'r1', cursor: 0, total: 50, status: 'running', resumed: false }))
      .mockResolvedValueOnce(ok({ cursor: 25, total: 50, status: 'running', advanced: true }))
      .mockResolvedValueOnce(ok({ cursor: 50, total: 50, status: 'done', advanced: true }))

    render(<ScannerButton resumable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /avvia scansione/i }))

    expect(screen.getByRole('button')).toBeDisabled()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/scanner', expect.objectContaining({ method: 'POST' }))
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/scanner/step', expect.objectContaining({ method: 'POST', body: JSON.stringify({ runId: 'r1' }) }))
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('offers to resume an interrupted scan', () => {
    render(<ScannerButton resumable />)
    expect(screen.getByRole('button', { name: /riprendi scansione/i })).toBeInTheDocument()
  })

  it('tells when a scan is too recent and when it can be started again', async () => {
    ;(fetch as any).mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({ error: 'Ultima scansione troppo recente', retryAt: '2026-11-16T11:30:00.000Z' }) })
    render(<ScannerButton resumable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /avvia scansione/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/troppo recente/i)
    expect(screen.getByRole('button')).not.toBeDisabled()
  })

  it('shows the error and lets the user resume when a step fails', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce(ok({ runId: 'r1', cursor: 0, total: 50, status: 'running', resumed: false }))
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'Scanner step failed' }) })
    render(<ScannerButton resumable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /avvia scansione/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Scanner step failed')
    expect(screen.getByRole('button', { name: /riprendi scansione/i })).not.toBeDisabled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('treats a 409 from another tab as finished', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce(ok({ runId: 'r1', cursor: 25, total: 50, status: 'running', resumed: true }))
      .mockResolvedValueOnce({ ok: false, status: 409, json: () => Promise.resolve({ error: 'Scan already finished' }) })
    render(<ScannerButton resumable />)
    fireEvent.click(screen.getByRole('button', { name: /riprendi scansione/i }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is disabled with the unlock time when a scan finished a moment ago, and never calls the API', () => {
    render(<ScannerButton resumable={false} lockedLabel="Disponibile dalle 23:40" />)
    expect(screen.getByRole('button', { name: /avvia scansione/i })).toBeDisabled()
    expect(screen.getByText('Disponibile dalle 23:40')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows the percentage while scanning', async () => {
    let release: (v: unknown) => void = () => {}
    ;(fetch as any)
      .mockResolvedValueOnce(ok({ runId: 'r1', cursor: 125, total: 500, status: 'running', resumed: false }))
      .mockImplementationOnce(() => new Promise((r) => { release = r }))
    render(<ScannerButton resumable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /avvia scansione/i }))
    expect(await screen.findByText('25%')).toBeInTheDocument()
    expect(screen.getByText(/125 di 500/)).toBeInTheDocument()
    release(ok({ cursor: 500, total: 500, status: 'done', advanced: true }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('shows the wait message while scanning', async () => {
    let release: (v: unknown) => void = () => {}
    ;(fetch as any)
      .mockResolvedValueOnce(ok({ runId: 'r1', cursor: 0, total: 50, status: 'running', resumed: false }))
      .mockImplementationOnce(() => new Promise((r) => { release = r }))
    render(<ScannerButton resumable={false} />)
    expect(screen.queryByText(/lascia aperta questa pagina/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /avvia scansione/i }))
    expect(await screen.findByText(/lascia aperta questa pagina/i)).toBeInTheDocument()
    release(ok({ cursor: 50, total: 50, status: 'done', advanced: true }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})
