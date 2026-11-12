import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriceChart } from '@/components/PriceChart'

describe('PriceChart', () => {
  it('renders a message instead of a chart when there is no history', () => {
    render(<PriceChart snapshots={[]} />)
    expect(screen.getByText(/no price history yet/i)).toBeInTheDocument()
  })

  it('renders a single-point message when there is exactly one snapshot', () => {
    render(<PriceChart snapshots={[{ price: 100, timestamp: new Date() }]} />)
    expect(screen.getByText(/only one data point/i)).toBeInTheDocument()
  })

  it('renders an svg chart when there are multiple snapshots', () => {
    render(
      <PriceChart
        snapshots={[
          { price: 100, timestamp: new Date('2026-11-01') },
          { price: 110, timestamp: new Date('2026-11-02') },
        ]}
      />
    )
    expect(screen.getByRole('img', { name: /price history chart/i })).toBeInTheDocument()
  })
})
