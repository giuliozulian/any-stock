import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PerformanceTiles } from '@/components/PerformanceTiles'

describe('PerformanceTiles', () => {
  it('renders one labelled tile per period with a signed percentage', () => {
    render(
      <PerformanceTiles
        returns={[
          { key: '1M', returnPct: 12.34 },
          { key: 'YTD', returnPct: -8.5 },
          { key: 'MAX', returnPct: 412345.6 },
        ]}
      />,
    )
    expect(screen.getByText('1 mese')).toBeInTheDocument()
    expect(screen.getByText('+12,3%')).toHaveAttribute('data-tone', 'gain')
    expect(screen.getByText('Da inizio anno')).toBeInTheDocument()
    expect(screen.getByText('−8,5%')).toHaveAttribute('data-tone', 'loss')
    expect(screen.getByText('Tutto lo storico')).toBeInTheDocument()
    expect(screen.getByText('+412.346%')).toBeInTheDocument()
  })

  it('does not render periods that were omitted from the calculation', () => {
    render(<PerformanceTiles returns={[{ key: '1A', returnPct: 5 }]} />)
    expect(screen.getByText('1 anno')).toBeInTheDocument()
    expect(screen.queryByText('20 anni')).not.toBeInTheDocument()
    expect(screen.queryByText('10 anni')).not.toBeInTheDocument()
  })

  it('renders nothing without returns', () => {
    const { container } = render(<PerformanceTiles returns={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
