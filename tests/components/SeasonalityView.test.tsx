import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SeasonalityView } from '@/components/SeasonalityView'
import type { MonthStat, Seasonality, SeasonalWindow, WindowKey } from '@/lib/seasonality'

const ramp = (end: number) => Array.from({ length: 365 }, (_, i) => (i / 364) * end)
const stat = (month: number, avgPct: number, positive: number, count: number): MonthStat => ({ month, avgPct, positive, count })
const WEEKDAYS = [
  { weekday: 1, avgPct: 0.12, positiveSharePct: 55.4, count: 500 },
  { weekday: 5, avgPct: -0.05, positiveSharePct: 48, count: 498 },
]
const win = (key: WindowKey, fromYear: number, toYear: number, months: MonthStat[], weekdays = WEEKDAYS): SeasonalWindow => ({ key, fromYear, toYear, months, curve: ramp(10), weekdays })
const yearRow = (year: number, partial = false) => ({ year, months: Array.from({ length: 12 }, (_, m) => (partial && m > 10 ? null : m + 1)), returnPct: 20, partial })

const TEN = [stat(0, 1.5, 6, 10), stat(10, 4.2, 8, 10), stat(11, 1.1, 6, 10)]
const DATA: Seasonality = {
  years: [yearRow(2026, true), ...Array.from({ length: 10 }, (_, i) => yearRow(2025 - i))],
  windows: [win('5', 2021, 2025, [stat(0, 1, 3, 5), stat(10, 2, 3, 5), stat(11, -1, 2, 5)]), win('10', 2016, 2025, TEN), win('all', 2016, 2025, TEN)],
  defaultWindow: '10',
  currentYear: 2026,
  currentYearCurve: ramp(5).slice(0, 320),
  electionCycle: [
    { key: 'election', avgPct: 12, positive: 2, count: 3 },
    { key: 'midterm', avgPct: -4, positive: 1, count: 3 },
  ],
  currentCycle: 'midterm',
  currentMonth: 10,
  nextMonth: 11,
  todayIndex: 319,
}

const items = (name: string) => within(screen.getByRole('list', { name })).getAllByRole('listitem')

describe('SeasonalityView', () => {
  it('opens on the default window with its period and its sentence about now', () => {
    render(<SeasonalityView data={DATA} />)
    expect(screen.getByRole('button', { name: '10 anni' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '5 anni' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('2016–2025')).toBeInTheDocument()
    expect(screen.getByText('Novembre è stato positivo 8 anni su 10, in media +4,2%. Dicembre: 6 su 10, in media +1,1%.')).toBeInTheDocument()
  })

  it('offers only the windows the history covers', () => {
    render(<SeasonalityView data={DATA} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['5 anni', '10 anni', 'Tutto'])
  })

  it('recomputes sentence, bars and table rows when another window is chosen', () => {
    render(<SeasonalityView data={DATA} />)
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(12)
    fireEvent.click(screen.getByRole('button', { name: '5 anni' }))
    expect(screen.getByRole('button', { name: '5 anni' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('2021–2025')).toBeInTheDocument()
    expect(screen.getByText('Novembre è stato positivo 3 anni su 5, in media +2,0%. Dicembre: 2 su 5, in media −1,0%.')).toBeInTheDocument()
    expect(items('Rendimento medio per mese')[1]).toHaveTextContent('3 su 5')
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(7)
    expect(screen.getByRole('rowheader', { name: '2026' })).toBeInTheDocument()
    expect(screen.queryByRole('rowheader', { name: '2020' })).not.toBeInTheDocument()
  })

  it('highlights the current and the next month', () => {
    render(<SeasonalityView data={DATA} />)
    const rows = items('Rendimento medio per mese')
    expect(rows.map((r) => r.getAttribute('data-highlight'))).toEqual(['false', 'true', 'true'])
    expect(rows[1]).toHaveTextContent('Nov')
    expect(rows[1]).toHaveTextContent('+4,2%')
    expect(rows[1]).toHaveTextContent('8 su 10')
  })

  it('shows weekday averages with two decimals and the share of positive days', () => {
    render(<SeasonalityView data={DATA} />)
    const rows = items('Rendimento medio per giorno della settimana')
    expect(rows[0]).toHaveTextContent('Lunedì')
    expect(rows[0]).toHaveTextContent('+0,12%')
    expect(rows[0]).toHaveTextContent('55% positivi')
    expect(rows[1]).toHaveTextContent('Venerdì')
    expect(rows[1]).toHaveTextContent('−0,05%')
  })

  it('shows the presidential cycle on the whole history and highlights the current cycle year', () => {
    render(<SeasonalityView data={DATA} />)
    const rows = items('Rendimento annuo medio per anno del ciclo presidenziale USA')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Elezione')
    expect(rows[0]).toHaveAttribute('data-highlight', 'false')
    expect(rows[1]).toHaveTextContent('Metà mandato')
    expect(rows[1]).toHaveTextContent('−4,0%')
    expect(rows[1]).toHaveTextContent('1 su 3')
    expect(rows[1]).toHaveAttribute('data-highlight', 'true')
    expect(screen.getByText('Calcolato su tutto lo storico.')).toBeInTheDocument()
  })

  it('draws the seasonal curve with the current year', () => {
    render(<SeasonalityView data={DATA} />)
    expect(screen.getByRole('img', { name: /Curva stagionale media: fine anno a \+10,0%\. 2026 finora/ })).toBeInTheDocument()
  })

  it('uses the singular for one positive year and drops a month without statistics', () => {
    render(<SeasonalityView data={{ ...DATA, windows: [win('all', 2023, 2025, [stat(10, 2, 1, 3)])], defaultWindow: 'all' }} />)
    expect(screen.getByText('Novembre è stato positivo 1 anno su 3, in media +2,0%.')).toBeInTheDocument()
  })

  it('hides the sentence, the month block and the weekday block when the window has no statistics for them', () => {
    render(<SeasonalityView data={{ ...DATA, windows: [win('all', 2023, 2025, [], [])], defaultWindow: 'all' }} />)
    expect(screen.queryByText(/è stato positivo/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Rendimento medio per mese' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Giorno della settimana' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Curva stagionale' })).toBeInTheDocument()
  })
})
