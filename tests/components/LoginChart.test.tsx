import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { LoginChart } from '@/app/login/LoginChart'

describe('LoginChart', () => {
  it('is decoration only: hidden from assistive technology, no text, nothing focusable', () => {
    const { container } = render(<LoginChart />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(container.textContent).toBe('')
    expect(container.querySelectorAll('a, button, input')).toHaveLength(0)
  })

  it('draws one price line, one dashed reference line and one end point', () => {
    const { container } = render(<LoginChart />)
    expect(container.querySelectorAll('path[data-role="price"]')).toHaveLength(1)
    expect(container.querySelectorAll('line[data-role="reference"]')).toHaveLength(1)
    expect(container.querySelectorAll('circle[data-role="end"]')).toHaveLength(1)
  })

  it('builds a valid path with only finite numbers, rising from left to right', () => {
    const { container } = render(<LoginChart />)
    const d = container.querySelector('path[data-role="price"]')!.getAttribute('d')!
    expect(d).toMatch(/^M[\d.\s,L-]+$/)
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
    expect(numbers.every(Number.isFinite)).toBe(true)
    const ys = numbers.filter((_, i) => i % 2 === 1)
    expect(ys[ys.length - 1]).toBeLessThan(ys[0]) // SVG y grows downwards: the line ends higher than it starts
  })
})
