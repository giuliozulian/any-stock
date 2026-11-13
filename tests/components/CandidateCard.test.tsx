import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CandidateCard } from '@/components/CandidateCard'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const CANDIDATE = {
  symbol: 'MSFT',
  name: 'Microsoft',
  market: 'US' as const,
  score: 72,
  reason: 'Movimento forte, fondamentali solidi.',
  partial: false,
}

describe('CandidateCard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('renders symbol, score and reason', () => {
    render(<CandidateCard candidate={CANDIDATE} />)
    expect(screen.getByText('MSFT')).toBeInTheDocument()
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText(/Movimento forte/)).toBeInTheDocument()
  })

  it('shows a "dati parziali" badge when partial is true', () => {
    render(<CandidateCard candidate={{ ...CANDIDATE, partial: true }} />)
    expect(screen.getByText(/dati parziali/i)).toBeInTheDocument()
  })

  it('adds the symbol to the watchlist and hides the card on success', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ stock: { symbol: 'MSFT' } }) })
    render(<CandidateCard candidate={CANDIDATE} />)

    fireEvent.click(screen.getByRole('button', { name: /aggiungi a watchlist/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/stocks', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(screen.queryByText('MSFT')).not.toBeInTheDocument())
  })

  it('shows "già in watchlist" instead of a generic error on a 409', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({ error: 'MSFT is already in the watchlist' }) })
    render(<CandidateCard candidate={CANDIDATE} />)

    fireEvent.click(screen.getByRole('button', { name: /aggiungi a watchlist/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('already in the watchlist')
  })

  it('dismisses the candidate and hides the card', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    render(<CandidateCard candidate={CANDIDATE} />)

    fireEvent.click(screen.getByRole('button', { name: /scarta/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/discover/MSFT', expect.objectContaining({ method: 'PATCH' })))
    await waitFor(() => expect(screen.queryByText('MSFT')).not.toBeInTheDocument())
  })
})
