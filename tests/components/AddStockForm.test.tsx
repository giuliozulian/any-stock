import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddStockForm } from '@/components/AddStockForm'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push }),
}))

describe('AddStockForm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('submits the typed symbol to POST /api/stocks', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ stock: { symbol: 'AAPL' } }) })

    render(<AddStockForm />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'aapl' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/stocks', expect.objectContaining({ method: 'POST' })))
  })

  it('shows an inline error message when the API rejects the symbol', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'No symbol found for "ZZZZZ"' }) })

    render(<AddStockForm />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ZZZZZ' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No symbol found for "ZZZZZ"')
  })

  it('shows a generic error and re-enables the button when fetch itself rejects', async () => {
    ;(fetch as any).mockRejectedValue(new TypeError('Failed to fetch'))

    render(<AddStockForm />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'AAPL' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to add symbol/i)
    expect(screen.getByRole('button', { name: /add/i })).not.toBeDisabled()
  })

  it('shows a generic error when the API returns a non-JSON error body', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, json: () => Promise.reject(new SyntaxError('Unexpected token')) })

    render(<AddStockForm />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'AAPL' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to add symbol/i)
  })

  it('suggests matching symbols and opens the stock page when one is picked', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ results: [{ symbol: 'AAPL', description: 'APPLE INC', type: 'Common Stock' }] }) })

    render(<AddStockForm />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'appl' } })

    const option = await screen.findByRole('option', { name: /AAPL/ })
    fireEvent.mouseDown(option)
    expect(push).toHaveBeenCalledWith('/stock/AAPL')
  })
})
