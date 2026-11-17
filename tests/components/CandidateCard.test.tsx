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
  reason: 'Movimento forte, fondamentali solidi.\nNessun acquisto dei politici.\nConti considerati: ROE 20%.\nOggi +5%.',
  partial: false,
  source: 'peer',
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
    expect(screen.getByText('Simile a un tuo titolo')).toBeInTheDocument()
  })

  it('shows a "dati parziali" badge when partial is true', () => {
    render(<CandidateCard candidate={{ ...CANDIDATE, partial: true }} />)
    expect(screen.getByText(/dati incompleti/i)).toBeInTheDocument()
  })

  it('shows a "cluster insider" badge when the source includes edgar-form4-cluster', () => {
    render(<CandidateCard candidate={{ ...CANDIDATE, source: 'peer,edgar-form4-cluster' }} />)
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

  it('hides the candidate for 30 days and offers an undo', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    render(<CandidateCard candidate={CANDIDATE} />)

    fireEvent.click(screen.getByRole('button', { name: /nascondi 30 giorni/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/discover/MSFT', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ days: 30 }) })))
    expect(await screen.findByRole('status')).toHaveTextContent('MSFT nascosto per 30 giorni')
    expect(screen.queryByText('Microsoft')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /annulla/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/discover/MSFT', expect.objectContaining({ method: 'DELETE' })))
    expect(await screen.findByText('Microsoft')).toBeInTheDocument()
  })

  it('can hide it for good', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    render(<CandidateCard candidate={CANDIDATE} />)

    fireEvent.click(screen.getByRole('button', { name: /mai più/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/discover/MSFT', expect.objectContaining({ body: JSON.stringify({ days: null }) })))
    expect(await screen.findByRole('status')).toHaveTextContent('per sempre')
  })

  it('shows price, change, market cap, warnings, the scanner bridge and what is new', () => {
    render(<CandidateCard candidate={{ ...CANDIDATE, price: 410.5, changePct: -1.25, marketCap: 3.1e12, flags: ['Trimestrale domani'], scannerPassed: 7, isNew: true, scoreDelta: 8, spark: [1, 2, 3] }} />)
    expect(screen.getByText(/\$410\.50/)).toBeInTheDocument()
    expect(screen.getByText(/−1\.3%/)).toBeInTheDocument()
    expect(screen.getByText(/cap\. 3\.1 mila mld/)).toBeInTheDocument()
    expect(screen.getByText('Trimestrale domani')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Minervini SCAN: 7/8 criteri' })).toHaveAttribute('href', '/scanner')
    expect(screen.getByText('Nuovo')).toBeInTheDocument()
    expect(screen.getByText(/▲ 8/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /ultimi 3 mesi di MSFT/ })).toBeInTheDocument()
  })

  it('shows an unmeasured pillar as n.d. and a small score change as nothing', () => {
    render(<CandidateCard candidate={{ ...CANDIDATE, insiderScore: -1, scoreDelta: 2 }} />)
    expect(screen.getByText('n.d.')).toBeInTheDocument()
    expect(screen.queryByText(/▲|▼/)).not.toBeInTheDocument()
  })
})
