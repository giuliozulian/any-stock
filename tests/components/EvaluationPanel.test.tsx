import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EvaluationPanel } from '@/components/EvaluationPanel'
import type { Evaluation } from '@/lib/evaluate'

function fullEvaluation(): Evaluation {
  return {
    sinceWatching: { pct: 12.3, sinceDate: new Date('2026-10-01'), note: 'Da quando segui questo titolo (dal 01/10/2026): +12.3%.' },
    shortTerm: { label: 'Positivo', note: 'Il prezzo è vicino al massimo delle ultime 52 settimane.' },
    mediumTerm: { label: 'Consenso positivo, in miglioramento', note: '30 analisti su 49 raccomandano l\'acquisto.', strongBuy: 11, buy: 19, hold: 15, sell: 3, strongSell: 1 },
    longTerm: { label: 'Fondamentali solidi', note: 'PEG 0.80, ROE 20.0%, debito/capitale 0.50.' },
    targetPrice: { value: 60, upsidePct: -40, note: "Stima indicativa basata sulla crescita storica degli utili." },
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
    targetPrice: { value: null, upsidePct: null, note: 'Stima non disponibile: utili o crescita storica non adatti a questo calcolo.' },
    newsImpact: { counted: 0, positive: 0, negative: 0, net: 0, adjustment: 0, note: 'Nessuna notizia recente abbastanza rilevante e sicura da pesare nel giudizio.' },
    details: { pegRatio: null, roe: null, debtToEquity: null, netMargin: null, dividendYield: null, payoutRatio: null },
  }
}

describe('EvaluationPanel', () => {
  it('renders all five signal rows with their labels and notes', () => {
    render(<EvaluationPanel evaluation={fullEvaluation()} />)
    expect(screen.getByText('Positivo')).toBeInTheDocument()
    expect(screen.getByText('Consenso positivo, in miglioramento')).toBeInTheDocument()
    expect(screen.getByText('Fondamentali solidi')).toBeInTheDocument()
    expect(screen.getByText('$60.00')).toBeInTheDocument()
    expect(screen.getByText(/stima indicativa/i)).toBeInTheDocument()
  })

  it('renders every not-available note without crashing for a freshly-added stock', () => {
    render(<EvaluationPanel evaluation={emptyEvaluation()} />)
    expect(screen.getByText('Nessun dato disponibile')).toBeInTheDocument()
    expect(screen.getByText('Dati fondamentali non disponibili')).toBeInTheDocument()
    expect(screen.getByText(/stima non disponibile/i)).toBeInTheDocument()
  })
})
