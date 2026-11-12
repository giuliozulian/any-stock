import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RefreshButton } from '@/components/RefreshButton'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

describe('RefreshButton', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('calls POST /api/stocks/:symbol/refresh when clicked', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) })

    render(<RefreshButton symbol="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/stocks/AAPL/refresh', expect.objectContaining({ method: 'POST' }))
    )
  })

  it('shows an inline error when the refresh fails', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Finnhub request failed: 429 /quote' }) })

    render(<RefreshButton symbol="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Finnhub request failed: 429 /quote')
  })

  it('shows a generic error and re-enables the button when fetch itself rejects', async () => {
    ;(fetch as any).mockRejectedValue(new TypeError('Failed to fetch'))

    render(<RefreshButton symbol="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to refresh/i)
    expect(screen.getByRole('button', { name: /refresh/i })).not.toBeDisabled()
  })
})
