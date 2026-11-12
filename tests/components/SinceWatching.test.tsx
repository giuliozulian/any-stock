import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SinceWatching } from '@/components/SinceWatching'

describe('SinceWatching', () => {
  it('shows the written date, entry and current price and the gain', () => {
    render(<SinceWatching addedAt={new Date('2026-10-01T12:00:00Z')} entryPrice={100} currentPrice={112.3} />)
    expect(screen.getByText(/1 ottobre 2026/i)).toBeInTheDocument()
    expect(screen.getByText('$100.00')).toBeInTheDocument()
    expect(screen.getByText('$112.30')).toBeInTheDocument()
    expect(screen.getByText('+12.3%')).toBeInTheDocument()
    expect(screen.getByText('+$12.30 per azione')).toBeInTheDocument()
  })

  it('shows the loss with a minus sign', () => {
    render(<SinceWatching addedAt={new Date('2026-10-01T12:00:00Z')} entryPrice={200} currentPrice={150} />)
    expect(screen.getByText('−25.0%')).toBeInTheDocument()
  })

  it('invites a refresh when there is no movement yet', () => {
    render(<SinceWatching addedAt={new Date()} entryPrice={50} currentPrice={50} />)
    expect(screen.getByText(/appena aggiunto/i)).toBeInTheDocument()
  })
})
