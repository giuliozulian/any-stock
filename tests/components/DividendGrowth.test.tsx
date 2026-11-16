import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DividendGrowth } from '@/components/DividendGrowth'
import type { DividendGrowthStats } from '@/lib/dividends'

const GROWTH: DividendGrowthStats = { completeYears: 11, firstCompleteYear: 2015, consecutiveIncreases: 10, cagr5Pct: 12.34, cagr10Pct: 8, cutYears: [] }
const tile = (label: string) => screen.getByText(label).closest('div') as HTMLElement

describe('DividendGrowth', () => {
  it('shows the consecutive increases and both growth rates, and says there was no cut', () => {
    render(<DividendGrowth growth={GROWTH} />)
    expect(tile('Anni consecutivi di aumento')).toHaveTextContent('10')
    expect(tile('Crescita annua media 5 anni')).toHaveTextContent('+12,3%')
    expect(tile('Crescita annua media 10 anni')).toHaveTextContent('+8,0%')
    expect(screen.getByText('Nessun taglio dal 2015')).toBeInTheDocument()
  })

  it('lists the years with a cut', () => {
    render(<DividendGrowth growth={{ ...GROWTH, cutYears: [2017, 2019] }} />)
    expect(screen.getByText('Tagli: 2017, 2019')).toBeInTheDocument()
    expect(screen.queryByText(/Nessun taglio/)).not.toBeInTheDocument()
  })

  it('leaves out the growth rates that cannot be computed', () => {
    render(<DividendGrowth growth={{ ...GROWTH, cagr5Pct: null, cagr10Pct: null }} />)
    expect(screen.getByText('Anni consecutivi di aumento')).toBeInTheDocument()
    expect(screen.queryByText('Crescita annua media 5 anni')).not.toBeInTheDocument()
    expect(screen.queryByText('Crescita annua media 10 anni')).not.toBeInTheDocument()
  })

  it('tones a negative growth rate as a loss and zero increases as flat', () => {
    const { container } = render(<DividendGrowth growth={{ ...GROWTH, consecutiveIncreases: 0, cagr5Pct: -3.2, cagr10Pct: null }} />)
    expect(Array.from(container.querySelectorAll('dd')).map((d) => [d.textContent, d.getAttribute('data-tone')])).toEqual([
      ['0', 'flat'],
      ['−3,2%', 'loss'],
    ])
  })

  it('renders nothing with fewer than two complete years', () => {
    const { container } = render(<DividendGrowth growth={{ ...GROWTH, completeYears: 1 }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
