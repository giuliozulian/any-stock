import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RemoveStockButton } from '@/components/RemoveStockButton'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

describe('RemoveStockButton', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('calls DELETE /api/stocks/:symbol when clicked', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) })

    render(<RemoveStockButton symbol="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /rimuovi/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/stocks/AAPL', expect.objectContaining({ method: 'DELETE' })))
  })

  it('shows an inline error when removal fails', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'AAPL is not in the watchlist' }) })

    render(<RemoveStockButton symbol="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /rimuovi/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('AAPL is not in the watchlist')
  })

  it('shows a generic error and re-enables the button when fetch itself rejects', async () => {
    ;(fetch as any).mockRejectedValue(new TypeError('Failed to fetch'))

    render(<RemoveStockButton symbol="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /rimuovi/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to remove/i)
    expect(screen.getByRole('button', { name: /rimuovi/i })).not.toBeDisabled()
  })
})
