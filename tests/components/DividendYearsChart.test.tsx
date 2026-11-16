import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DividendYearsChart } from '@/components/DividendYearsChart'

const NBSP = ' '
const YEARS = [
  { year: 2022, total: 1.68, count: 4, partial: false },
  { year: 2023, total: 0, count: 0, partial: false },
  { year: 2024, total: 1.84, count: 4, partial: false },
  { year: 2025, total: 0.5, count: 1, partial: true },
]

describe('DividendYearsChart', () => {
  it('draws a bar for every year that paid, none for an empty year, with partial years marked', () => {
    const { container } = render(<DividendYearsChart years={YEARS} currency="USD" />)
    const bars = container.querySelectorAll('rect[data-tone]')
    expect(bars).toHaveLength(3)
    expect(Array.from(bars).map((b) => b.getAttribute('data-partial'))).toEqual(['false', 'false', 'true'])
    const titles = Array.from(container.querySelectorAll('title')).map((t) => t.textContent)
    expect(titles).toEqual([`2022: 1,68${NBSP}$ in 4 pagamenti`, `2024: 1,84${NBSP}$ in 4 pagamenti`, `2025: 0,50${NBSP}$ in 1 pagamento (parziale)`])
  })

  it('scales bar heights to the largest yearly total', () => {
    const { container } = render(<DividendYearsChart years={YEARS} currency="USD" />)
    const heights = Array.from(container.querySelectorAll('rect[data-tone]')).map((b) => Number(b.getAttribute('height')))
    expect(heights[1]).toBeCloseTo(166)
    expect(heights[0]).toBeCloseTo(151.57, 1)
    expect(heights[2]).toBeCloseTo(45.11, 1)
  })

  it('summarises the chart in its accessible name and in visible text', () => {
    render(<DividendYearsChart years={YEARS} currency="USD" />)
    expect(screen.getByRole('img', { name: /dal 2022 al 2025: 3 anni con pagamenti su 4\. Massimo 1,84.\$ nel 2024/ })).toBeInTheDocument()
    expect(screen.getByText(/Massimo: 1,84.\$ \(2024\)/)).toBeInTheDocument()
    expect(screen.getByText(/anno parziale/i)).toBeInTheDocument()
  })

  it('shows only the last fifteen years', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ year: 2006 + i, total: 1 + i, count: 4, partial: false }))
    const { container } = render(<DividendYearsChart years={many} currency="EUR" />)
    expect(container.querySelectorAll('rect[data-tone]')).toHaveLength(15)
    expect(screen.getByRole('img', { name: /dal 2011 al 2025/ })).toBeInTheDocument()
  })

  it('renders without NaN when no year paid anything', () => {
    const { container } = render(
      <DividendYearsChart
        years={[
          { year: 2024, total: 0, count: 0, partial: false },
          { year: 2025, total: 0, count: 0, partial: true },
        ]}
        currency="USD"
      />,
    )
    expect(container.querySelectorAll('rect[data-tone]')).toHaveLength(0)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('renders nothing without years', () => {
    const { container } = render(<DividendYearsChart years={[]} currency="USD" />)
    expect(container).toBeEmptyDOMElement()
  })
})
