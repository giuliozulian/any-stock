import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PriceHistoryChart } from '@/components/PriceHistoryChart'

const DAY = 86_400_000
const END = Date.UTC(2026, 10, 13, 14, 30)
// Ascending series ending at END, one point every `step` days, price rising by 1 per point from 10.
const series = (count: number, step: number) => Array.from({ length: count }, (_, i) => ({ t: END - (count - 1 - i) * step * DAY, close: 10 + i }))

const YEAR = series(250, 1)
const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent)

describe('PriceHistoryChart long ranges', () => {
  it('shows no long ranges without a long series', () => {
    render(<PriceHistoryChart points={YEAR} />)
    expect(tabs()).toEqual(['1M', '3M', '6M', 'YTD', '1A'])
  })

  it('shows 5A, 10A and Max when the long series covers them', () => {
    render(<PriceHistoryChart points={YEAR} long={series(12 * 52, 7)} />)
    expect(tabs()).toEqual(['1M', '3M', '6M', 'YTD', '1A', '5A', '10A', 'Max'])
  })

  it('hides the ranges the long series is too short for', () => {
    render(<PriceHistoryChart points={YEAR} long={series(6 * 52, 7)} />)
    expect(tabs()).toEqual(['1M', '3M', '6M', 'YTD', '1A', '5A', 'Max'])
  })

  it('shows only Max for a recently listed stock', () => {
    render(<PriceHistoryChart points={series(40, 1)} long={series(40, 1)} />)
    expect(tabs()).toEqual(['1M', '3M', '6M', 'YTD', '1A', 'Max'])
  })

  it('plots the whole long series on Max', () => {
    const long = series(12 * 52, 7)
    render(<PriceHistoryChart points={YEAR} long={long} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Max' }))
    expect(screen.getByRole('tab', { name: 'Max' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/da inizio storico/)).toBeInTheDocument()
    expect(screen.getByText(new Date(long[0].t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }))).toBeInTheDocument()
  })

  it('limits 5A to the last five years of the long series', () => {
    render(<PriceHistoryChart points={YEAR} long={series(12 * 52, 7)} />)
    fireEvent.click(screen.getByRole('tab', { name: '5A' }))
    expect(screen.getByText(/in 5 anni/)).toBeInTheDocument()
    expect(screen.getByText(/Minimo \$3\d\d\.00/)).toBeInTheDocument()
  })

  it('ends long ranges on the freshest daily close', () => {
    const long = series(12 * 52, 7).map((p) => ({ ...p, t: p.t - DAY }))
    render(<PriceHistoryChart points={[...YEAR.slice(0, -1), { t: END, close: 999 }]} long={long} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Max' }))
    expect(screen.getByText('$999.00')).toBeInTheDocument()
  })

  it('keeps the existing period wording for short ranges', () => {
    render(<PriceHistoryChart points={YEAR} />)
    expect(screen.getByText(/in 3 mesi/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '1M' }))
    expect(screen.getByText(/in 1 mese/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '1A' }))
    expect(screen.getByText(/in 1 anno/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'YTD' }))
    expect(screen.getByText(/da inizio anno/)).toBeInTheDocument()
  })
})
