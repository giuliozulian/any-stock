import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ScannerTable, type ScannerRow } from '@/components/ScannerTable'
import { TREND_TEMPLATE_LABELS } from '@/lib/minervini'

const row = (over: Partial<ScannerRow>): ScannerRow => ({
  symbol: 'AAA', name: 'Alpha', sector: 'Tech', price: 100, rs: 90, passedCount: 8, vcpStatus: null, pivot: null, pivotDistancePct: null, missing: null, ...over,
})

describe('ScannerTable', () => {
  const rows = [
    row({ symbol: 'LOW', name: 'Low RS', rs: 75 }),
    row({ symbol: 'TOP', name: 'Top RS', rs: 99, vcpStatus: 'forming', pivot: 105, pivotDistancePct: -4.8 }),
    row({ symbol: 'NEAR', name: 'Near miss', rs: 60, passedCount: 7, missing: TREND_TEMPLATE_LABELS[7] }),
  ]

  it('sorts the 8/8 stocks by RS and links each to its page', () => {
    render(<ScannerTable rows={rows} />)
    const section = screen.getByRole('region', { name: /8 criteri su 8/i })
    const links = within(section).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/stock/TOP', '/stock/LOW'])
  })

  it('shows VCP state, pivot and distance', () => {
    render(<ScannerTable rows={rows} />)
    expect(screen.getByText('Base pronta')).toBeInTheDocument()
    expect(screen.getByText('105.00')).toBeInTheDocument()
    expect(screen.getByText(/4,8% sotto/)).toBeInTheDocument()
  })

  it('lists the 7/8 stocks apart with the criterion they miss', () => {
    render(<ScannerTable rows={rows} />)
    const near = screen.getByRole('region', { name: /quasi/i })
    expect(within(near).getByText('Near miss')).toBeInTheDocument()
    expect(within(near).getByText(TREND_TEMPLATE_LABELS[7])).toBeInTheDocument()
  })

  it('filters to bases forming or breaking out', () => {
    render(<ScannerTable rows={rows} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /solo vcp/i }))
    const section = screen.getByRole('region', { name: /8 criteri su 8/i })
    expect(within(section).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/stock/TOP'])
  })

  it('shows an empty message when no stock passes', () => {
    render(<ScannerTable rows={[]} />)
    expect(screen.getAllByText(/nessun titolo/i).length).toBeGreaterThan(0)
  })

  it('writes a dash for a missing RS or pivot', () => {
    render(<ScannerTable rows={[row({ symbol: 'NORS', rs: null })]} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
