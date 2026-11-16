import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DrawdownChart } from '@/components/DrawdownChart'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const SERIES = [
  { t: at('2021-11-19'), drawdownPct: 0 },
  { t: at('2022-10-14'), drawdownPct: -66 },
  { t: at('2026-10-05'), drawdownPct: 0 },
  { t: at('2026-11-13'), drawdownPct: -25 },
]
const SUMMARY = { currentPct: -25, peakT: at('2026-10-05'), daysSincePeak: 42, maxPct: -66, maxPeakT: at('2021-11-19'), maxTroughT: at('2022-10-14') }

describe('DrawdownChart', () => {
  it('states the current drawdown and the worst one in a sentence', () => {
    render(<DrawdownChart series={SERIES} summary={SUMMARY} />)
    expect(screen.getByText('Ora a −25,0% dal massimo del 5 ottobre 2026 (42 giorni fa). Crollo peggiore: −66,0%, da novembre 2021 a ottobre 2022.')).toBeInTheDocument()
  })

  it('uses the sentence as the accessible name of the chart', () => {
    render(<DrawdownChart series={SERIES} summary={SUMMARY} />)
    expect(screen.getByRole('img', { name: /Ora a −25,0% dal massimo del 5 ottobre 2026/ })).toBeInTheDocument()
  })

  it('says so when the stock is at its all-time high', () => {
    render(<DrawdownChart series={SERIES} summary={{ ...SUMMARY, currentPct: 0, daysSincePeak: 0 }} />)
    expect(screen.getByText('Sui massimi storici. Crollo peggiore: −66,0%, da novembre 2021 a ottobre 2022.')).toBeInTheDocument()
  })

  it('omits the worst drawdown when there has never been one', () => {
    render(<DrawdownChart series={SERIES} summary={{ ...SUMMARY, currentPct: 0, maxPct: 0 }} />)
    expect(screen.getByText('Sui massimi storici.')).toBeInTheDocument()
  })

  it('handles a peak one day ago and a drawdown within a single month', () => {
    render(<DrawdownChart series={SERIES} summary={{ ...SUMMARY, daysSincePeak: 1, maxPeakT: at('2022-10-03'), maxTroughT: at('2022-10-14') }} />)
    expect(screen.getByText('Ora a −25,0% dal massimo del 5 ottobre 2026 (1 giorno fa). Crollo peggiore: −66,0%, a ottobre 2022.')).toBeInTheDocument()
  })

  it('renders a flat series without NaN', () => {
    const flat = [{ t: at('2026-01-05'), drawdownPct: 0 }, { t: at('2026-11-13'), drawdownPct: 0 }]
    const { container } = render(<DrawdownChart series={flat} summary={{ ...SUMMARY, currentPct: 0, maxPct: 0 }} />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('renders points sharing one timestamp without NaN', () => {
    const same = [{ t: at('2026-11-13'), drawdownPct: 0 }, { t: at('2026-11-13'), drawdownPct: -5 }]
    const { container } = render(<DrawdownChart series={same} summary={SUMMARY} />)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('shows only the sentence when there is nothing to plot', () => {
    const { container } = render(<DrawdownChart series={[]} summary={SUMMARY} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText(/Ora a −25,0%/)).toBeInTheDocument()
  })
})
