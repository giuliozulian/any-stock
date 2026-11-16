import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { YearlyReturnsChart } from '@/components/YearlyReturnsChart'

const YEARS = [
  { year: 2023, returnPct: 20, partial: true },
  { year: 2024, returnPct: -25, partial: false },
  { year: 2025, returnPct: 50, partial: false },
  { year: 2026, returnPct: 11.1, partial: true },
]

describe('YearlyReturnsChart', () => {
  it('draws one bar per year, toned by sign, with partial years marked', () => {
    const { container } = render(<YearlyReturnsChart years={YEARS} />)
    const bars = container.querySelectorAll('rect[data-tone]')
    expect(bars).toHaveLength(4)
    expect(bars[0]).toHaveAttribute('data-tone', 'gain')
    expect(bars[1]).toHaveAttribute('data-tone', 'loss')
    expect(bars[0]).toHaveAttribute('data-partial', 'true')
    expect(bars[1]).toHaveAttribute('data-partial', 'false')
    const titles = Array.from(container.querySelectorAll('title')).map((t) => t.textContent)
    expect(titles).toEqual(['2023: +20,0% (parziale)', '2024: −25,0%', '2025: +50,0%', '2026: +11,1% (parziale)'])
  })

  it('summarises the chart in its accessible name and in visible text', () => {
    render(<YearlyReturnsChart years={YEARS} />)
    expect(screen.getByRole('img', { name: /dal 2023 al 2026: 3 anni positivi su 4/i })).toBeInTheDocument()
    expect(screen.getByText(/Migliore: 2025 \(\+50,0%\)/)).toBeInTheDocument()
    expect(screen.getByText(/Peggiore: 2024 \(−25,0%\)/)).toBeInTheDocument()
    expect(screen.getByText(/anno parziale/i)).toBeInTheDocument()
  })

  it('renders without NaN when every return is zero', () => {
    const { container } = render(<YearlyReturnsChart years={[{ year: 2025, returnPct: 0, partial: false }, { year: 2026, returnPct: 0, partial: true }]} />)
    expect(container.innerHTML).not.toContain('NaN')
    expect(container.querySelectorAll('rect[data-tone]')).toHaveLength(2)
  })

  it('thins year labels on very long histories', () => {
    const many = Array.from({ length: 64 }, (_, i) => ({ year: 1963 + i, returnPct: i % 2 ? 5 : -5, partial: false }))
    const { container } = render(<YearlyReturnsChart years={many} />)
    const labels = Array.from(container.querySelectorAll('text')).map((t) => t.textContent)
    expect(labels.length).toBeLessThanOrEqual(10)
    expect(labels).toContain('2026')
    expect(container.querySelectorAll('rect[data-tone]')).toHaveLength(64)
  })

  it('renders nothing without years', () => {
    const { container } = render(<YearlyReturnsChart years={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
