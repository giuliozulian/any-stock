import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScanChart } from '@/components/ScanChart'

afterEach(() => vi.unstubAllGlobals())

describe('ScanChart', () => {
  it('asks for the chart of the symbol and shows a loading note meanwhile', () => {
    const fetchMock = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    render(<ScanChart symbol="BRK.B" />)
    expect(fetchMock).toHaveBeenCalledWith('/api/scanner/chart/BRK.B')
    expect(screen.getByRole('status', { name: /carico il grafico/i })).toBeInTheDocument()
  })

  it('says so when the prices cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })))
    render(<ScanChart symbol="ELV" />)
    expect(await screen.findByText(/grafico non disponibile/i)).toBeInTheDocument()
  })
})
