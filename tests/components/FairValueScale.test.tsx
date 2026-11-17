import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FairValueScale } from '@/components/FairValueScale'

const models = [
  { key: 'graham-number', label: 'Numero di Graham', value: 106.07 },
  { key: 'lynch', label: 'Peter Lynch', value: 125 },
  { key: 'graham-growth', label: 'Graham con crescita', value: 188.22 },
]

describe('FairValueScale', () => {
  it('describes every model and the price in words, for screen readers', () => {
    render(<FairValueScale models={models} low={106.07} high={188.22} price={150} reliable />)
    const label = screen.getByRole('img').getAttribute('aria-label')!
    for (const m of models) expect(label).toContain(m.label)
    expect(label).toContain('106.07')
    expect(label).toContain('Prezzo 150.00')
  })

  it('draws one point per model, one price marker and one band', () => {
    const { container } = render(<FairValueScale models={models} low={106.07} high={188.22} price={150} reliable />)
    expect(container.querySelectorAll('[data-role="model"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-role="price"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-role="band"]')).toHaveLength(1)
  })

  it('marks the band as reliable or not', () => {
    const { container, rerender } = render(<FairValueScale models={models} low={106.07} high={188.22} price={150} reliable />)
    expect(container.querySelector('[data-role="band"]')).toHaveAttribute('data-reliable', 'true')
    rerender(<FairValueScale models={models} low={106.07} high={188.22} price={150} reliable={false} />)
    expect(container.querySelector('[data-role="band"]')).toHaveAttribute('data-reliable', 'false')
  })

  it('keeps every point inside the track, even for a price far from the models', () => {
    const { container } = render(<FairValueScale models={models} low={106.07} high={188.22} price={900} reliable={false} />)
    const lefts = [...container.querySelectorAll<HTMLElement>('[data-role="model"], [data-role="price"]')].map((el) => parseFloat(el.style.left))
    expect(lefts.every((l) => l >= 0 && l <= 100)).toBe(true)
  })

  it('puts the price marker to the left of the models when the price is lower', () => {
    const { container } = render(<FairValueScale models={models} low={106.07} high={188.22} price={60} reliable />)
    const price = parseFloat(container.querySelector<HTMLElement>('[data-role="price"]')!.style.left)
    const first = Math.min(...[...container.querySelectorAll<HTMLElement>('[data-role="model"]')].map((el) => parseFloat(el.style.left)))
    expect(price).toBeLessThan(first)
  })
})
