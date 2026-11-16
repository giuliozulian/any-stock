import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SeasonalBars } from '@/components/SeasonalBars'

const BARS = [
  { key: 'a', label: 'Gen', valuePct: 10, value: '+10,0%', detail: '8 su 10', highlight: true },
  { key: 'b', label: 'Feb', valuePct: -20, value: '−20,0%', detail: '3 su 10' },
  { key: 'c', label: 'Mar', valuePct: 0, value: '0,0%', detail: '0 su 10' },
]

const barOf = (row: HTMLElement) => row.querySelector('[data-bar]') as HTMLElement

describe('SeasonalBars', () => {
  it('lists one row per bar with label, value and detail', () => {
    render(<SeasonalBars bars={BARS} label="Rendimento medio per mese" />)
    const rows = within(screen.getByRole('list', { name: 'Rendimento medio per mese' })).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Gen')
    expect(rows[0]).toHaveTextContent('+10,0%')
    expect(rows[0]).toHaveTextContent('8 su 10')
  })

  it('tones rows by sign and marks highlighted ones', () => {
    render(<SeasonalBars bars={BARS} label="Mesi" />)
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-tone'))).toEqual(['gain', 'loss', 'flat'])
    expect(rows.map((r) => r.getAttribute('data-highlight'))).toEqual(['true', 'false', 'false'])
  })

  it('grows gains to the right and losses to the left of the centre, scaled to the largest', () => {
    render(<SeasonalBars bars={BARS} label="Mesi" />)
    const rows = screen.getAllByRole('listitem')
    expect(barOf(rows[0]).style.left).toBe('50%')
    expect(barOf(rows[0]).style.width).toBe('25%')
    expect(barOf(rows[1]).style.left).toBe('0%')
    expect(barOf(rows[1]).style.width).toBe('50%')
    expect(barOf(rows[2]).style.width).toBe('0%')
  })

  it('renders without NaN when every value is zero', () => {
    const { container } = render(<SeasonalBars bars={[{ key: 'a', label: 'Gen', valuePct: 0, value: '0,0%', detail: '0 su 3' }]} label="Mesi" />)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('renders nothing without bars', () => {
    const { container } = render(<SeasonalBars bars={[]} label="Mesi" />)
    expect(container).toBeEmptyDOMElement()
  })
})
