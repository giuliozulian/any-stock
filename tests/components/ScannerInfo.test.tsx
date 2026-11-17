import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScannerInfo } from '@/components/ScannerInfo'
import { TREND_TEMPLATE_LABELS } from '@/lib/minervini'

describe('ScannerInfo', () => {
  it('lists the eight criteria with the same labels as the stock page', () => {
    render(<ScannerInfo />)
    for (const label of TREND_TEMPLATE_LABELS) expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('says where it looks, what it does not check, where the data comes from, and that it is not advice', () => {
    render(<ScannerInfo />)
    expect(screen.getByText(/S&P 500/)).toBeInTheDocument()
    expect(screen.getByText(/utili, ricavi/i)).toBeInTheDocument()
    expect(screen.getByText(/Yahoo Finance/)).toBeInTheDocument()
    expect(screen.getByText(/barra di oggi/i)).toBeInTheDocument()
    expect(screen.getByText(/non è consulenza finanziaria/i)).toBeInTheDocument()
  })

  it('is collapsed by default and open when asked', () => {
    const { container, rerender } = render(<ScannerInfo />)
    expect(container.querySelector('details')).not.toHaveAttribute('open')
    rerender(<ScannerInfo defaultOpen />)
    expect(container.querySelector('details')).toHaveAttribute('open')
  })

  it('is a plain toggle labelled as a how-it-works note, not a boxed section', () => {
    const { container } = render(<ScannerInfo />)
    expect(screen.getByText('Come funziona', { selector: 'summary' })).toBeInTheDocument()
    expect(container.querySelector('section')).toBeNull()
  })

  it('walks a beginner through buying, the stop and taking profit', () => {
    render(<ScannerInfo />)
    expect(screen.getByText(/cerca i titoli .si può comprare./i)).toBeInTheDocument()
    expect(screen.getByText(/compra solo nell.intervallo indicato/i)).toBeInTheDocument()
    expect(screen.getByText(/imposta subito lo stop/i)).toBeInTheDocument()
    expect(screen.getByText(/alza lo stop e incassa/i)).toBeInTheDocument()
  })
})
