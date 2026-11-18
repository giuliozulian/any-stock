import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MinerviniAiAnalysis } from '@/components/MinerviniAiAnalysis'

const result = {
  verdict: 'wait',
  summary: 'Trend soddisfatto, base da completare.',
  criteria: [
    { ruleId: 'TT1', outcome: 'met', note: 'Prezzo sopra le medie.' },
    { ruleId: 'V5', outcome: 'not_assessable', note: 'Nessuna soglia nei libri.' },
  ],
  missing: ['Contrazione finale'],
  risks: ['Campione RS piccolo'],
  uncovered: ['Fondamentali'],
  model: 'gemini-x',
  adjusted: false,
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('MinerviniAiAnalysis', () => {
  afterEach(() => vi.restoreAllMocks())

  it('starts idle with a button and calls nothing until it is clicked', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ result, cached: false }))
    render(<MinerviniAiAnalysis symbol="AAPL" />)
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Analisi AI' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/minervini-ai/AAPL', { method: 'POST' })
    expect(await screen.findByRole('heading', { name: 'Da attendere' })).toBeInTheDocument()
  })

  it('shows the verdict, the criteria and the disclaimer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ result, cached: false }))
    render(<MinerviniAiAnalysis symbol="AAPL" autoStart />)
    expect(await screen.findByRole('heading', { name: 'Da attendere' })).toBeInTheDocument()
    expect(screen.getByText('Trend soddisfatto, base da completare.')).toBeInTheDocument()
    expect(screen.getByText('TT1')).toBeInTheDocument()
    expect(screen.getByText('Non valutabile')).toBeInTheDocument()
    expect(screen.getByText('Contrazione finale')).toBeInTheDocument()
    expect(screen.getByText(/non è consulenza finanziaria/i)).toBeInTheDocument()
  })

  it('says when the verdict was lowered by the numbers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ result: { ...result, adjusted: true }, cached: true }))
    render(<MinerviniAiAnalysis symbol="AAPL" autoStart />)
    expect(await screen.findByText(/verdetto abbassato/i)).toBeInTheDocument()
  })

  it('shows a skeleton while it loads', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<MinerviniAiAnalysis symbol="AAPL" autoStart />)
    expect(await screen.findByRole('status', { name: /analisi in corso/i })).toBeInTheDocument()
  })

  it('shows a short message when the analysis is not available, and offers a retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }))
    render(<MinerviniAiAnalysis symbol="AAPL" autoStart />)
    expect(await screen.findByText(/analisi ai non disponibile/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument())
  })

  it('words the verdict as being in line with the method, not as a signal to buy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ result: { ...result, verdict: 'ready' }, cached: false }))
    render(<MinerviniAiAnalysis symbol="AAPL" autoStart />)
    expect(await screen.findByRole('heading', { name: 'Setup in linea con il metodo' })).toBeInTheDocument()
  })

  it('shows the disclaimer before the first click too', () => {
    render(<MinerviniAiAnalysis symbol="AAPL" />)
    expect(screen.getByText(/non è consulenza finanziaria/i)).toBeInTheDocument()
  })

  it('renders repeated items without duplicate-key warnings', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ result: { ...result, risks: ['uguale', 'uguale'] }, cached: false }))
    render(<MinerviniAiAnalysis symbol="AAPL" autoStart />)
    await screen.findByRole('heading', { name: 'Da attendere' })
    expect(spy.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false)
  })
})
