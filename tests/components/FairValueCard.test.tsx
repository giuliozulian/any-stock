import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { FairValueCard } from '@/components/FairValueCard'
import type { FairValueInput } from '@/lib/fair-value'
import type { AltmanResult } from '@/lib/solidity'

// Models agree: Graham number 106.07, Lynch 125, cash flow 145.50, Graham with growth 188.22.
const agreeing = (price: number): FairValueInput => ({ price, epsTTM: 5, bookValuePerShare: 100, epsGrowth5Y: 25, dividendYield: 0, priceToFcf: price / 4.5 })
// Models disagree: 55.00 to 166.78.
const disagreeing: FairValueInput = { price: 100, epsTTM: 5, bookValuePerShare: 40, epsGrowth5Y: 10, dividendYield: 1, priceToFcf: 100 / 6 }
// Real AAPL data: Graham number is left out.
const aapl: FairValueInput = { price: 350, epsTTM: 8.9745, bookValuePerShare: 7.7134, epsGrowth5Y: 9.85, dividendYield: 0.3036, priceToFcf: 38.0533 }
const tooLittle: FairValueInput = { price: 100, epsTTM: null, bookValuePerShare: null, epsGrowth5Y: null, dividendYield: null, priceToFcf: null }
const altman = { score: 3.2, zone: 'safe' } as AltmanResult

const paragraph = (re: RegExp) => screen.getByText((_, el) => el?.tagName === 'P' && re.test(el.textContent ?? ''))

describe('FairValueCard', () => {
  it('shows the range and its centre', () => {
    render(<FairValueCard input={agreeing(150)} />)
    expect(screen.getByText('106.07–188.22')).toBeInTheDocument()
    expect(paragraph(/135\.25/)).toBeInTheDocument()
  })

  it('says how far the price is from the centre when the estimate is reliable', () => {
    render(<FairValueCard input={agreeing(150)} />)
    expect(paragraph(/10\.9\d% sopra il centro/)).toBeInTheDocument()
    expect(screen.queryByText(/stima poco affidabile/i)).not.toBeInTheDocument()
  })

  it('says the price is close to the centre when it is within 5%', () => {
    render(<FairValueCard input={agreeing(137)} />)
    expect(paragraph(/vicino al centro/i)).toBeInTheDocument()
  })

  it('says the estimate is unreliable, and gives no above or below judgement, when the models disagree', () => {
    render(<FairValueCard input={disagreeing} />)
    expect(screen.getByText(/stima poco affidabile/i)).toBeInTheDocument()
    expect(screen.getByText('55.00–166.78')).toBeInTheDocument()
    expect(screen.queryByText(/% sopra/)).not.toBeInTheDocument()
    expect(screen.queryByText(/% sotto/)).not.toBeInTheDocument()
  })

  it('draws the scale', () => {
    render(<FairValueCard input={agreeing(150)} />)
    expect(screen.getByRole('img', { name: /Prezzo 150\.00/ })).toBeInTheDocument()
  })

  it('lists the models in the details, and the ones left out with the reason', () => {
    render(<FairValueCard input={aapl} />)
    const details = screen.getByText(/come si arriva a questa stima/i).closest('details')!
    expect(within(details).getByText('Peter Lynch')).toBeInTheDocument()
    expect(within(details).getByText('Numero di Graham')).toBeInTheDocument()
    expect(within(details).getByText(/pochi attivi/)).toBeInTheDocument()
  })

  it('states the date the parameters were tuned and the main ones', () => {
    render(<FairValueCard input={agreeing(150)} />)
    expect(screen.getByText(/parametri tarati il \d{4}-\d{2}-\d{2}/i)).toBeInTheDocument()
    expect(screen.getByText(/sconto 9%/)).toBeInTheDocument()
  })

  it('renders nothing when there are fewer than two models and no Altman score', () => {
    const { container } = render(<FairValueCard input={tooLittle} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('still renders the Altman block, without the fair value tile, when only that is available', () => {
    render(<FairValueCard input={tooLittle} altman={altman} />)
    expect(screen.getAllByText('Altman Z-Score').length).toBeGreaterThan(0) // the label and the tooltip title
    expect(screen.getByText('3.20')).toBeInTheDocument()
    expect(screen.queryByText(/centro/i)).not.toBeInTheDocument()
  })
})
