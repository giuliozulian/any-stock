import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { AlertTargets } from '@/components/AlertTargets'

const base = { symbol: 'META', entryPrice: null, sellPrice: null, entryTriggered: false, sellTriggered: false }

describe('AlertTargets', () => {
  it('invites to set an alert when there is none', () => {
    render(<AlertTargets {...base} />)
    expect(screen.getByRole('button', { name: 'Imposta avvisi di prezzo' })).toBeInTheDocument()
  })

  it('shows each target with its level and how far it is from the current price', () => {
    render(<AlertTargets {...base} entryPrice={550} sellPrice={725} price={616.38} />)
    const button = screen.getByRole('button', { name: 'Modifica gli avvisi di prezzo' })
    expect(button).toHaveTextContent('Ingresso$550.00a −10.8%')
    expect(button).toHaveTextContent('Uscita$725.00a +17.6%')
  })

  it('says a target was reached instead of the distance', () => {
    render(<AlertTargets {...base} entryPrice={550} entryTriggered price={500} />)
    expect(screen.getByRole('button', { name: 'Modifica gli avvisi di prezzo' })).toHaveTextContent('raggiunto')
  })

  it('shows only the target that is set, with no distance when the price is unknown', () => {
    render(<AlertTargets {...base} sellPrice={725} />)
    const button = screen.getByRole('button', { name: 'Modifica gli avvisi di prezzo' })
    expect(button).toHaveTextContent('Uscita$725.00')
    expect(button).not.toHaveTextContent('Ingresso')
    expect(button).not.toHaveTextContent('a +')
  })
})
