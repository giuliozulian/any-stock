import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { FinvizScreen } from '@/components/FinvizScreen'

const plan = { verdict: 'watch', buyFrom: 94, buyTo: 98.7, stop: 86.5, riskPct: 8, profitFrom: 113, profitTo: 117.5 }
const pick = { symbol: 'RCEL', price: 100, passedCount: 8, rs: 91.2, verdict: 'watch', label: 'Da tenere d’occhio', plan, text: 'È in forma ma non ha ancora superato il livello chiave.', note: 'Crescita forte, base quasi pronta.' }

afterEach(() => vi.unstubAllGlobals())

describe('FinvizScreen', () => {
  it('runs the search on click and lists each stock with verdict and Gemini note', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ total: 58, passedTechnical: 17, truncated: false, noteAvailable: true, addedToScan: 3, picks: [pick] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<FinvizScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Cerca su Finviz' }))

    expect(await screen.findByRole('link', { name: 'RCEL' })).toHaveAttribute('href', '/stock/RCEL#minervini')
    expect(screen.getByText('Da tenere d’occhio')).toBeInTheDocument()
    expect(screen.getByText('Crescita forte, base quasi pronta.')).toBeInTheDocument()
    expect(screen.getByText(/58 titoli; 17 passano/)).toBeInTheDocument()
    expect(screen.getByText(/3 aggiunti alla lista dello scanner/)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/finviz-screen', { method: 'POST' })
  })

  it('shows the error the route gives, and lets the user try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Finviz non risponde o ha bloccato la richiesta. Riprova più tardi.' }), { status: 502 })))
    render(<FinvizScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Cerca su Finviz' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Finviz non risponde')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cerca su Finviz' })).toBeEnabled())
  })
})
