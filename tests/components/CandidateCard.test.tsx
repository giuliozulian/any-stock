import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CandidateCard } from '@/components/CandidateCard'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const CANDIDATE = {
  symbol: 'MSFT',
  name: 'Microsoft',
  market: 'US' as const,
  score: 72,
  momentumScore: 80,
  fundamentalsScore: 70,
  insiderScore: 66,
  reason: 'Movimento forte, fondamentali solidi.\nOggi +5%.\nConti considerati: ROE 20%.\nInsider: nessun acquisto.',
  partial: false,
  source: 'yahoo-movers-us',
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
    expect(screen.getByText(/Conti considerati/)).toBeInTheDocument()
    expect(screen.getByText('80/100')).toBeInTheDocument()
  })

  it('shows a "dati parziali" badge when partial is true', () => {
    render(<CandidateCard candidate={{ ...CANDIDATE, partial: true }} />)
    expect(screen.getByText(/dati incompleti/i)).toBeInTheDocument()
  })

  it('shows a "cluster insider" badge when the source includes edgar-form4-cluster', () => {
    render(<CandidateCard candidate={{ ...CANDIDATE, source: 'yahoo-movers-us,edgar-form4-cluster' }} />)
    expect(screen.getByText(/più insider comprano/i)).toBeInTheDocument()
  })

  it('does not show the "cluster insider" badge for a candidate from other sources', () => {
    render(<CandidateCard candidate={CANDIDATE} />)
    expect(screen.queryByText(/più insider comprano/i)).not.toBeInTheDocument()
  })

  it('adds the symbol to the watchlist and hides the card on success', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ stock: { symbol: 'MSFT' } }) })
    render(<CandidateCard candidate={CANDIDATE} />)

    fireEvent.click(screen.getByRole('button', { name: /aggiungi alla watchlist/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/stocks', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(screen.queryByText('MSFT')).not.toBeInTheDocument())
  })

  it('shows "già in watchlist" instead of a generic error on a 409', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({ error: 'MSFT is already in the watchlist' }) })
    render(<CandidateCard candidate={CANDIDATE} />)

    fireEvent.click(screen.getByRole('button', { name: /aggiungi alla watchlist/i }))

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
