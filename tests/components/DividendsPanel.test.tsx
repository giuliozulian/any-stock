import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DividendsPanel } from '@/components/DividendsPanel'
import type { DividendPayment } from '@/lib/dividends'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const pay = (iso: string, amount: number): DividendPayment => ({ t: at(iso), amount })
const NOW = new Date('2026-11-16T09:00:00Z')

// Quarterly payer raising the payment every year, 2021 to 2026: 0.40 ... 0.50 on 10 January, April, July and October.
const RAISING = [2021, 2022, 2023, 2024, 2025, 2026].flatMap((year, i) =>
  ['01', '04', '07', '10'].map((month) => pay(`${year}-${month}-10`, 0.4 + i * 0.02)),
)

describe('DividendsPanel', () => {
  it('renders the sentence, the yearly chart, the growth block and the data note', () => {
    render(<DividendsPanel history={{ payments: RAISING, currency: 'USD' }} price={100} now={NOW} />)
    expect(screen.getByText(/Paga ogni trimestre\. Ultimo dividendo 0,50.\$ il 10 ottobre 2026, rendimento 2,0% sugli ultimi 12 mesi\./)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Dividendi per anno' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Dividendi per azione anno per anno dal 2021 al 2026/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Crescita del dividendo' })).toBeInTheDocument()
    expect(screen.getByText('Anni consecutivi di aumento')).toBeInTheDocument()
    expect(screen.getByText(/dividendi straordinari inclusi/)).toBeInTheDocument()
    expect(screen.getByText(/I dividendi passati non garantiscono quelli futuri/)).toBeInTheDocument()
  })

  it('says the data is unavailable when Yahoo gave nothing', () => {
    render(<DividendsPanel history={null} price={100} now={NOW} />)
    expect(screen.getByText('Dati sui dividendi non disponibili al momento.')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('says the stock pays no dividends when Yahoo lists none', () => {
    render(<DividendsPanel history={{ payments: [], currency: 'USD' }} price={100} now={NOW} />)
    expect(screen.getByText('Questo titolo non distribuisce dividendi.')).toBeInTheDocument()
    expect(screen.queryByText(/non disponibili/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('handles a stock with a single payment: no rhythm, no growth block', () => {
    const { container } = render(<DividendsPanel history={{ payments: [pay('2026-05-04', 0.25)], currency: 'USD' }} price={50} now={NOW} />)
    expect(screen.getByText(/^Ultimo dividendo 0,25.\$ il 4 maggio 2026, rendimento 0,5% sugli ultimi 12 mesi\.$/)).toBeInTheDocument()
    expect(screen.queryByText(/^Paga/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Dividendi per anno' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Crescita del dividendo' })).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('leaves the yield out without a price', () => {
    render(<DividendsPanel history={{ payments: RAISING, currency: 'USD' }} price={null} now={NOW} />)
    expect(screen.getByText(/Ultimo dividendo 0,50.\$ il 10 ottobre 2026\./)).toBeInTheDocument()
    expect(screen.queryByText(/rendimento/)).not.toBeInTheDocument()
  })

  it('writes plain numbers when the currency is missing', () => {
    render(<DividendsPanel history={{ payments: RAISING, currency: null }} price={100} now={NOW} />)
    expect(screen.getByText(/Ultimo dividendo 0,50 il 10 ottobre 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })
})
