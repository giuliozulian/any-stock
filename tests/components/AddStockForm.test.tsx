import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddStockForm } from '@/components/AddStockForm'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

describe('AddStockForm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('submits the typed symbol to POST /api/stocks', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ stock: { symbol: 'AAPL' } }) })

    render(<AddStockForm />)
    fireEvent.change(screen.getByPlaceholderText(/symbol/i), { target: { value: 'aapl' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/stocks', expect.objectContaining({ method: 'POST' })))
  })

  it('shows an inline error message when the API rejects the symbol', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'No symbol found for "ZZZZZ"' }) })

    render(<AddStockForm />)
    fireEvent.change(screen.getByPlaceholderText(/symbol/i), { target: { value: 'ZZZZZ' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No symbol found for "ZZZZZ"')
  })

  it('shows a generic error and re-enables the button when fetch itself rejects', async () => {
    ;(fetch as any).mockRejectedValue(new TypeError('Failed to fetch'))

    render(<AddStockForm />)
    fireEvent.change(screen.getByPlaceholderText(/symbol/i), { target: { value: 'AAPL' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to add symbol/i)
    expect(screen.getByRole('button', { name: /add/i })).not.toBeDisabled()
  })

  it('shows a generic error when the API returns a non-JSON error body', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, json: () => Promise.reject(new SyntaxError('Unexpected token')) })

    render(<AddStockForm />)
    fireEvent.change(screen.getByPlaceholderText(/symbol/i), { target: { value: 'AAPL' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to add symbol/i)
  })
})
