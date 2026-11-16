import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PerformancePanel } from '@/components/PerformancePanel'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const NOW = new Date('2026-11-16T09:00:00Z')
const POINTS = [
  { t: at('2024-06-03'), close: 100 },
  { t: at('2024-12-31'), close: 120 },
  { t: at('2025-12-31'), close: 90 },
  { t: at('2026-10-05'), close: 160 },
  { t: at('2026-11-13'), close: 120 },
]

describe('PerformancePanel', () => {
  it('renders the three blocks from a price history', () => {
    render(<PerformancePanel history={{ points: POINTS, sparseBefore: null }} now={NOW} />)
    expect(screen.getByRole('heading', { name: 'Performance per periodo' })).toBeInTheDocument()
    expect(screen.getByText('Tutto lo storico')).toBeInTheDocument()
    expect(screen.getByText('+20,0%')).toBeInTheDocument()
    expect(screen.queryByText('5 anni')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Anno per anno' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /dal 2024 al 2026/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Distanza dai massimi' })).toBeInTheDocument()
    expect(screen.getByText(/Ora a −25,0% dal massimo del 5 ottobre 2026 \(42 giorni fa\)\. Crollo peggiore: −25,0%/)).toBeInTheDocument()
    expect(screen.getByText(/corretti per gli split, dividendi esclusi/)).toBeInTheDocument()
    expect(screen.queryByText(/meno fitti/)).not.toBeInTheDocument()
  })

  it('shows the unavailable message without a history', () => {
    render(<PerformancePanel history={{ points: [], sparseBefore: null }} now={NOW} />)
    expect(screen.getByText('Storico non disponibile al momento.')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('shows the unavailable message with a single close', () => {
    render(<PerformancePanel history={{ points: POINTS.slice(0, 1), sparseBefore: null }} now={NOW} />)
    expect(screen.getByText('Storico non disponibile al momento.')).toBeInTheDocument()
  })

  it('warns when old data is sparser than daily', () => {
    render(<PerformancePanel history={{ points: POINTS, sparseBefore: at('2016-11-16') }} now={NOW} />)
    expect(screen.getByText(/Prima del 16 novembre 2016 i dati sono meno fitti/)).toBeInTheDocument()
  })
})
