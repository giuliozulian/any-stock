import { describe, expect, it } from 'vitest'
import type { DividendFrequency, DividendSummary } from '@/lib/dividends'
import { dividendSentence, formatDividendAmount } from '@/lib/dividend-text'

const NBSP = ' '
const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)

const summary = (overrides: Partial<DividendSummary> = {}): DividendSummary => ({
  lastPayment: { t: at('2026-10-10'), amount: 0.5 },
  years: [],
  ttmTotal: 2,
  yieldPct: 2,
  frequency: 'quarterly',
  suspended: false,
  growth: { completeYears: 0, firstCompleteYear: null, consecutiveIncreases: 0, cagr5Pct: null, cagr10Pct: null, cutYears: [] },
  ...overrides,
})

describe('formatDividendAmount', () => {
  it('writes the amount in the currency symbol with at least two decimals', () => {
    expect(formatDividendAmount(0.51, 'USD')).toBe(`0,51${NBSP}$`)
    expect(formatDividendAmount(1.68, 'EUR')).toBe(`1,68${NBSP}€`)
    expect(formatDividendAmount(0.5, 'USD')).toBe(`0,50${NBSP}$`)
  })

  it('keeps up to four decimals for tiny amounts', () => {
    expect(formatDividendAmount(0.0125, 'USD')).toBe(`0,0125${NBSP}$`)
  })

  it('writes a bare number when the currency is missing', () => {
    expect(formatDividendAmount(0.5, null)).toBe('0,50')
  })

  it('writes a bare number when the currency code is not one Intl knows', () => {
    expect(formatDividendAmount(0.5, 'XX')).toBe('0,50')
  })

  it('never shows pence as pounds', () => {
    expect(formatDividendAmount(12.5, 'GBp')).toBe(`12,50${NBSP}p`)
  })
})

describe('dividendSentence', () => {
  it('names the rhythm, the last payment and the trailing yield', () => {
    expect(dividendSentence(summary(), 'USD')).toBe(`Paga ogni trimestre. Ultimo dividendo 0,50${NBSP}$ il 10 ottobre 2026, rendimento 2,0% sugli ultimi 12 mesi.`)
  })

  it.each<[DividendFrequency, string]>([
    ['monthly', 'Paga ogni mese. '],
    ['semiannual', "Paga due volte l'anno. "],
    ['annual', "Paga una volta l'anno. "],
    ['irregular', 'Paga senza cadenza regolare. '],
  ])('describes a %s payer', (frequency, opening) => {
    expect(dividendSentence(summary({ frequency }), 'USD').startsWith(opening)).toBe(true)
  })

  it('leaves the rhythm out when it is not known', () => {
    expect(dividendSentence(summary({ frequency: null }), 'USD')).toBe(`Ultimo dividendo 0,50${NBSP}$ il 10 ottobre 2026, rendimento 2,0% sugli ultimi 12 mesi.`)
  })

  it('leaves the yield out when there is none or it is zero', () => {
    const expected = `Paga ogni trimestre. Ultimo dividendo 0,50${NBSP}$ il 10 ottobre 2026.`
    expect(dividendSentence(summary({ yieldPct: null }), 'USD')).toBe(expected)
    expect(dividendSentence(summary({ yieldPct: 0 }), 'USD')).toBe(expected)
  })

  it('says the dividend is suspended and shows no yield, even when a trailing total exists', () => {
    expect(dividendSentence(summary({ suspended: true, yieldPct: 1.2 }), 'USD')).toBe(`Dividendo sospeso: l'ultimo pagamento è stato di 0,50${NBSP}$ il 10 ottobre 2026.`)
  })

  it('writes plain numbers when the currency is missing', () => {
    expect(dividendSentence(summary(), null)).toBe('Paga ogni trimestre. Ultimo dividendo 0,50 il 10 ottobre 2026, rendimento 2,0% sugli ultimi 12 mesi.')
  })
})
