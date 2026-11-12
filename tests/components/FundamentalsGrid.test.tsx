import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FundamentalsGrid } from '@/components/FundamentalsGrid'

describe('FundamentalsGrid', () => {
  it('shows rounded values with units and a plain-language explanation for each metric', () => {
    render(<FundamentalsGrid details={{ pegRatio: 0.45911, roe: 110.11, debtToEquity: 0.0538, netMargin: 63.66, dividendYield: 0.1665, payoutRatio: 5.2 }} />)
    expect(screen.getByText('0.46')).toBeInTheDocument()
    expect(screen.getByText('110.1%')).toBeInTheDocument()
    expect(screen.getByText('0.05')).toBeInTheDocument()
    expect(screen.getByText('63.7%')).toBeInTheDocument()
    expect(screen.getByText('0.17%')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /cos’è/i }).length).toBe(6)
    expect(screen.getAllByText(/non entra nel giudizio/i).length).toBe(3)
  })

  it('shows a dash and not-available status when data is missing', () => {
    render(<FundamentalsGrid details={{ pegRatio: null, roe: null, debtToEquity: -2, netMargin: null, dividendYield: null, payoutRatio: null }} />)
    expect(screen.getAllByText('—').length).toBe(6)
  })
})
