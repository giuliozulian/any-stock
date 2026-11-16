import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeasonalityPanel } from '@/components/SeasonalityPanel'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const NOW = new Date('2026-11-16T09:00:00Z')

// Every year: +10% by 31 January, +20% by 30 June, +100% by 31 December.
function yearly(fromYear: number, toYear: number) {
  const out = [{ t: at(`${fromYear - 1}-12-31`), close: 100 }]
  let base = 100
  for (let year = fromYear; year <= toYear; year++) {
    out.push({ t: at(`${year}-01-31`), close: base * 1.1 }, { t: at(`${year}-06-30`), close: base * 1.2 }, { t: at(`${year}-12-31`), close: base * 2 })
    base *= 2
  }
  return out
}

describe('SeasonalityPanel', () => {
  it('renders the seasonality blocks from a price history', () => {
    render(<SeasonalityPanel history={{ points: yearly(2014, 2025), sparseBefore: null }} now={NOW} />)
    expect(screen.getByRole('button', { name: '10 anni' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Curva stagionale' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rendimento medio per mese' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Anno per mese' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ciclo presidenziale USA' })).toBeInTheDocument()
    expect(screen.getByText(/La stagionalità descrive il passato, non è una previsione/)).toBeInTheDocument()
    expect(screen.queryByText(/meno fitti/)).not.toBeInTheDocument()
  })

  it('hides the weekday block when the history has no daily data', () => {
    render(<SeasonalityPanel history={{ points: yearly(2014, 2025), sparseBefore: null }} now={NOW} />)
    expect(screen.queryByRole('heading', { name: 'Giorno della settimana' })).not.toBeInTheDocument()
  })

  it('shows the unavailable message without a history', () => {
    render(<SeasonalityPanel history={{ points: [], sparseBefore: null }} now={NOW} />)
    expect(screen.getByText('Storico non disponibile al momento.')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('shows the too-short message with fewer than three complete years', () => {
    render(<SeasonalityPanel history={{ points: yearly(2024, 2025), sparseBefore: null }} now={NOW} />)
    expect(screen.getByText('Storico troppo breve per la stagionalità.')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('warns when old data is sparser than daily', () => {
    render(<SeasonalityPanel history={{ points: yearly(2014, 2025), sparseBefore: at('2016-11-16') }} now={NOW} />)
    expect(screen.getByText(/Prima del 16 novembre 2016 i dati sono meno fitti/)).toBeInTheDocument()
  })
})
