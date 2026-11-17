import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PivotGauge } from '@/components/PivotGauge'

describe('PivotGauge', () => {
  it('describes a price below the pivot in words', () => {
    render(<PivotGauge distancePct={-4.8} />)
    expect(screen.getByRole('img', { name: '4,8% sotto il pivot' })).toBeInTheDocument()
  })

  it('describes a price above the pivot in words', () => {
    render(<PivotGauge distancePct={2.3} />)
    expect(screen.getByRole('img', { name: '2,3% sopra il pivot' })).toBeInTheDocument()
  })

  it('marks the zone: below the pivot, inside the 5% buy zone, past it', () => {
    const zone = (d: number) => {
      const { container, unmount } = render(<PivotGauge distancePct={d} />)
      const z = container.querySelector('[data-zone]')!.getAttribute('data-zone')
      unmount()
      return z
    }
    expect(zone(-3)).toBe('below')
    expect(zone(0)).toBe('buy')
    expect(zone(5)).toBe('buy')
    expect(zone(5.1)).toBe('late')
  })

  it('keeps the marker inside the track for extreme distances', () => {
    const { container } = render(<PivotGauge distancePct={-80} />)
    const left = parseFloat((container.querySelector('[data-zone]') as HTMLElement).style.left)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(left).toBeLessThanOrEqual(100)
  })

  it('shows a dash when there is no pivot', () => {
    render(<PivotGauge distancePct={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
