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
})
