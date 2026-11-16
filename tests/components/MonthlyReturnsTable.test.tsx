import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MonthlyReturnsTable } from '@/components/MonthlyReturnsTable'

const ROWS = [
  { year: 2026, months: [5, -2, 0, 1, 1, 1, 1, 1, 1, 1, -3, null], returnPct: 12, partial: true },
  { year: 2025, months: [1, null, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], returnPct: -8, partial: false },
]

function cells(year: string) {
  const row = screen.getByRole('rowheader', { name: year }).closest('tr') as HTMLElement
  return within(row).getAllByRole('cell')
}

describe('MonthlyReturnsTable', () => {
  it('shows one row per year with twelve months and the year total', () => {
    render(<MonthlyReturnsTable rows={ROWS} currentMonth={10} />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Anno', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic', 'Totale'])
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['2026', '2025'])
    expect(cells('2026')).toHaveLength(13)
    expect(cells('2026')[0]).toHaveTextContent('+5,0%')
    expect(cells('2025')[12]).toHaveTextContent('−8,0%')
  })

  it('tones cells by sign', () => {
    render(<MonthlyReturnsTable rows={ROWS} currentMonth={10} />)
    expect(cells('2026').slice(0, 3).map((c) => c.getAttribute('data-tone'))).toEqual(['gain', 'loss', 'flat'])
    expect(cells('2025')[12]).toHaveAttribute('data-tone', 'loss')
  })

  it('leaves missing months empty', () => {
    render(<MonthlyReturnsTable rows={ROWS} currentMonth={10} />)
    expect(cells('2025')[1]).toBeEmptyDOMElement()
    expect(cells('2025')[1]).toHaveAttribute('data-empty', 'true')
    expect(cells('2026')[11]).toBeEmptyDOMElement()
  })

  it('marks the running month and the running year total as partial', () => {
    render(<MonthlyReturnsTable rows={ROWS} currentMonth={10} />)
    expect(cells('2026')[10]).toHaveAttribute('data-partial', 'true')
    expect(cells('2026')[12]).toHaveAttribute('data-partial', 'true')
    expect(cells('2026')[0]).toHaveAttribute('data-partial', 'false')
    expect(cells('2025')[10]).toHaveAttribute('data-partial', 'false')
    expect(cells('2025')[12]).toHaveAttribute('data-partial', 'false')
  })

  it('renders nothing without rows', () => {
    const { container } = render(<MonthlyReturnsTable rows={[]} currentMonth={10} />)
    expect(container).toBeEmptyDOMElement()
  })
})
