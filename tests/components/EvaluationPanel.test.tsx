import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EvaluationPanel, overallTone } from '@/components/EvaluationPanel'
import type { Evaluation } from '@/lib/evaluate'

function fullEvaluation(): Evaluation {
  return {
    sinceWatching: { pct: 12.3, sinceDate: new Date('2026-10-01'), note: 'Da quando segui questo titolo (dal 01/10/2026): +12.3%.' },
    shortTerm: { label: 'Positivo', note: 'Il prezzo è vicino al massimo delle ultime 52 settimane.' },
    mediumTerm: { label: 'Consenso positivo, in miglioramento', note: '30 analisti su 49 raccomandano l\'acquisto.', strongBuy: 11, buy: 19, hold: 15, sell: 3, strongSell: 1 },
    longTerm: { label: 'Fondamentali solidi', note: 'PEG 0.80, ROE 20.0%, debito/capitale 0.50.' },
    fairValue: { position: 'above', reliable: true, low: 40, high: 50, median: 45, note: "Il prezzo è sopra l'intervallo di valore equo (40.00–50.00)." },
    newsImpact: { counted: 0, positive: 0, negative: 0, net: 0, adjustment: 0, note: 'Nessuna notizia recente abbastanza rilevante e sicura da pesare nel giudizio.' },
    details: { pegRatio: 0.8, roe: 20, debtToEquity: 0.5, netMargin: 22, dividendYield: 0.5, payoutRatio: 10 },
  }
}

function emptyEvaluation(): Evaluation {
  return {
    sinceWatching: { pct: null, sinceDate: null, note: 'Appena aggiunto, nessun dato storico ancora.' },
    shortTerm: { label: 'Neutro', note: 'Dati di momentum non disponibili per questo titolo.' },
    mediumTerm: { label: 'Nessun dato disponibile', note: 'Nessun dato sul consenso degli analisti disponibile per questo titolo.', strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 },
    longTerm: { label: 'Dati fondamentali non disponibili', note: 'Non ci sono abbastanza dati fondamentali per valutare questo titolo nel lungo periodo.' },
    fairValue: { position: null, reliable: false, low: null, high: null, median: null, note: 'Valore equo non disponibile: servono almeno due modelli con dati adatti.' },
    newsImpact: { counted: 0, positive: 0, negative: 0, net: 0, adjustment: 0, note: 'Nessuna notizia recente abbastanza rilevante e sicura da pesare nel giudizio.' },
    details: { pegRatio: null, roe: null, debtToEquity: null, netMargin: null, dividendYield: null, payoutRatio: null },
  }
}

describe('EvaluationPanel', () => {
  it('renders all five signal rows with their labels and notes', () => {
    render(<EvaluationPanel evaluation={fullEvaluation()} />)
    expect(screen.getAllByText('Positivo')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Consenso positivo, in miglioramento')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Fondamentali solidi')[0]).toBeInTheDocument()
  })

  it('renders every not-available note without crashing for a freshly-added stock', () => {
    render(<EvaluationPanel evaluation={emptyEvaluation()} />)
    expect(screen.getAllByText('Nessun dato disponibile')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Dati fondamentali non disponibili')[0]).toBeInTheDocument()
  })
})

describe('overallTone', () => {
  const tones = (...t: string[]) => t as Parameters<typeof overallTone>[0]

  it('adds one point when the price is below a reliable fair value range', () => {
    expect(overallTone(tones('neutral', 'unknown', 'neutral'), 'below')).toBe('neutral') // 0 + 1 = 1
    expect(overallTone(tones('positive', 'unknown', 'neutral'), 'below')).toBe('positive') // 1 + 1 = 2
  })

  it('takes one point away when the price is above it', () => {
    expect(overallTone(tones('positive', 'unknown', 'positive'), 'above')).toBe('neutral')
    expect(overallTone(tones('negative', 'negative', 'unknown'), 'above')).toBe('negative')
  })

  it('does not move the verdict inside the range, when it is unclear, or when it is missing', () => {
    for (const position of ['inside', 'unclear', null] as const) {
      expect(overallTone(tones('positive', 'unknown', 'positive'), position)).toBe('positive')
      expect(overallTone(tones('neutral', 'neutral', 'neutral'), position)).toBe('neutral')
    }
  })

  it('still adds the news adjustment', () => {
    expect(overallTone(tones('positive', 'neutral', 'neutral'), 'unclear', 1)).toBe('positive')
  })

  it('is unknown when no signal is known, whatever the fair value says', () => {
    expect(overallTone(tones('unknown', 'unknown', 'unknown'), 'below')).toBe('unknown')
  })
})
