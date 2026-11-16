import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeasonalCurveChart } from '@/components/SeasonalCurveChart'

const CURVE = Array.from({ length: 365 }, (_, i) => (i / 364) * 10)
const CURRENT = [0, -1, -2]
const pointCount = (el: Element | null) => el?.getAttribute('points')?.split(' ').length

describe('SeasonalCurveChart', () => {
  it('draws the average curve, the current year and the today marker', () => {
    const { container } = render(<SeasonalCurveChart curve={CURVE} current={CURRENT} todayIndex={2} year={2026} />)
    expect(pointCount(container.querySelector('[data-series="average"]'))).toBe(365)
    expect(pointCount(container.querySelector('[data-series="current"]'))).toBe(3)
    expect(container.querySelector('[data-role="today"]')).toBeInTheDocument()
    expect(container.querySelectorAll('text')).toHaveLength(12)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('summarises the chart in its accessible name and labels the lines', () => {
    render(<SeasonalCurveChart curve={CURVE} current={CURRENT} todayIndex={2} year={2026} />)
    expect(screen.getByRole('img', { name: 'Curva stagionale media: fine anno a +10,0%. 2026 finora: −2,0%.' })).toBeInTheDocument()
    expect(screen.getByText('Media')).toBeInTheDocument()
    expect(screen.getByText('2026')).toBeInTheDocument()
  })

  it('omits the current-year line when the year has no close yet', () => {
    const { container } = render(<SeasonalCurveChart curve={CURVE} current={[]} todayIndex={0} year={2027} />)
    expect(container.querySelector('[data-series="current"]')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Curva stagionale media: fine anno a +10,0%.' })).toBeInTheDocument()
    expect(screen.queryByText('2027')).not.toBeInTheDocument()
    expect(container.querySelector('[data-role="today"]')).toBeInTheDocument()
  })

  it('renders without NaN when the curve is flat at zero', () => {
    const { container } = render(<SeasonalCurveChart curve={new Array(365).fill(0)} current={[0, 0]} todayIndex={1} year={2026} />)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('renders nothing without a curve', () => {
    const { container } = render(<SeasonalCurveChart curve={[]} current={[]} todayIndex={0} year={2026} />)
    expect(container).toBeEmptyDOMElement()
  })
})
