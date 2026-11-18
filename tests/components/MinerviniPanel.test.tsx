import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MinerviniPanel } from '@/components/MinerviniPanel'
import type { Level, Vcp } from '@/lib/minervini'
import type { MinerviniAnalysis } from '@/lib/minervini-data'

const criteria = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, label: `Criterio ${i + 1}`, ok: i !== 7, value: `v${i + 1}`, margin: i === 7 ? null : 0.05 }))
const levels: Level[] = [
  { key: 'price', label: 'Prezzo', value: 100 },
  { key: 'sma50', label: 'Media 50 giorni', value: 95 },
  { key: 'sma150', label: 'Media 150 giorni', value: 90 },
  { key: 'sma200', label: 'Media 200 giorni', value: 85 },
]
const vcp: Vcp = { contractions: [0.25, 0.12, 0.06], pivot: 94, volumeDryUp: true, suggestedStop: 86.48, lastLow: 88.36, status: 'forming', volumeRatio: 0.8, base: null }
const analysis: MinerviniAnalysis = {
  template: { criteria, passedCount: 7, total: 8, passed: false, stage2: true, levels },
  vcp,
  peerCount: 12,
}

describe('MinerviniPanel', () => {
  it('gives a verdict, groups the criteria and shows entry and stop', () => {
    render(<MinerviniPanel analysis={analysis} />)
    expect(screen.getByRole('heading', { name: 'In salita, ma non ancora un leader' })).toBeInTheDocument()
    expect(screen.getByText(/manca: criterio 8/)).toBeInTheDocument()
    expect(screen.getByText(/su 8 controlli/)).toBeInTheDocument()
    expect(screen.getByText('Stage 2', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '7 controlli superati su 8' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByLabelText('Criterio 8: non soddisfatto, v8')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Discese della base: 25%, 12%, 6%' })).toBeInTheDocument()
    expect(screen.getByText(/si entra solo se il prezzo supera 94,00 .*stop a 86,48/)).toBeInTheDocument()
    expect(screen.getByText('Base pronta')).toBeInTheDocument()
    expect(screen.getByText('Pivot, prezzo d’ingresso')).toBeInTheDocument()
  })

  it('with all eight criteria says whether to buy or wait, why, and the prices', () => {
    const all = criteria.map((c) => ({ ...c, ok: true }))
    const base = { ...analysis, template: { ...analysis.template, criteria: all, passedCount: 8, passed: true } }
    const { rerender } = render(<MinerviniPanel analysis={base} symbol="RCEL" />)
    expect(screen.getByText('Da tenere d’occhio')).toBeInTheDocument()
    expect(screen.getByText(/non ha ancora superato il livello chiave \(94,00\)/)).toBeInTheDocument()
    expect(screen.getByText(/Acquisto tra 94,00 e 98,70 · stop 86,48/)).toBeInTheDocument()

    rerender(<MinerviniPanel analysis={{ ...base, vcp: { ...vcp, status: 'breakout', volumeRatio: 2 } }} symbol="RCEL" />)
    expect(screen.getByText('Si può comprare')).toBeInTheDocument()

    rerender(<MinerviniPanel analysis={{ ...base, vcp: { ...vcp, status: 'breakout', volumeRatio: 0.9 } }} symbol="RCEL" />)
    expect(screen.getByText('Aspetta conferma')).toBeInTheDocument()
  })

  it('shows the ideal and actual order of price and averages', () => {
    const swapped = levels.map((l) => (l.key === 'price' ? { ...l, value: 92 } : l))
    render(<MinerviniPanel analysis={{ ...analysis, template: { ...analysis.template, levels: swapped } }} />)
    expect(screen.getByRole('figure', { name: /Media 50 giorni 95,00, Prezzo 92,00.*2 su 4 al posto giusto/ })).toBeInTheDocument()
  })

  it('flags a criterion missed by less than 1% as a near miss', () => {
    const near = criteria.map((c) => (c.id === 1 ? { ...c, ok: false, margin: -0.003 } : c))
    render(<MinerviniPanel analysis={{ ...analysis, template: { ...analysis.template, criteria: near, stage2: false } }} />)
    expect(screen.getByLabelText('Criterio 1: mancato per poco, v1')).toBeInTheDocument()
    expect(screen.getByText(/mancano per meno dell’1%/)).toBeInTheDocument()
  })

  it('does not look for an entry until the stock is in Stage 2', () => {
    render(<MinerviniPanel analysis={{ ...analysis, template: { ...analysis.template, stage2: false } }} />)
    expect(screen.getByText('Non ancora')).toBeInTheDocument()
    expect(screen.queryByText('Pivot, prezzo d’ingresso')).not.toBeInTheDocument()
  })

  it('warns against chasing an extended breakout and on weak breakout volume', () => {
    const { rerender } = render(<MinerviniPanel analysis={{ ...analysis, vcp: { ...vcp, status: 'extended' } }} />)
    expect(screen.getByText(/comprare ora vuol dire inseguire/)).toBeInTheDocument()
    rerender(<MinerviniPanel analysis={{ ...analysis, vcp: { ...vcp, status: 'breakout', volumeRatio: 1.1 } }} />)
    expect(screen.getByText(/con pochi scambi/)).toBeInTheDocument()
    rerender(<MinerviniPanel analysis={{ ...analysis, vcp: { ...vcp, status: 'breakout', volumeRatio: 1.6 } }} />)
    expect(screen.getByText(/è il momento d’ingresso del metodo/)).toBeInTheDocument()
  })

  it('says to wait when the stock is not in an uptrend', () => {
    const down = { ...analysis, template: { ...analysis.template, passed: false, stage2: false, passedCount: 2 } }
    render(<MinerviniPanel analysis={down} />)
    expect(screen.getByRole('heading', { name: 'Per ora non è in salita' })).toBeInTheDocument()
    expect(screen.queryByText(/si entra solo se/)).not.toBeInTheDocument()
  })

  it('says when no VCP is detected', () => {
    render(<MinerviniPanel analysis={{ ...analysis, vcp: { ...vcp, contractions: [], pivot: null, suggestedStop: null, lastLow: null, status: null } }} />)
    expect(screen.getByText(/Nessuna base trovata/)).toBeInTheDocument()
    expect(screen.getByText(/Nessun punto d’ingresso chiaro/)).toBeInTheDocument()
  })

  it('says the data is insufficient when there is no analysis', () => {
    render(<MinerviniPanel analysis={null} />)
    expect(screen.getByText(/Dati insufficienti/)).toBeInTheDocument()
  })
})
