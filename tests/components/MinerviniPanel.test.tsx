import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MinerviniPanel } from '@/components/MinerviniPanel'
import type { MinerviniAnalysis } from '@/lib/minervini-data'

const criteria = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, label: `Criterio ${i + 1}`, ok: i !== 7, value: `v${i + 1}` }))
const analysis: MinerviniAnalysis = {
  template: { criteria, passedCount: 7, total: 8, passed: false, stage2: true },
  vcp: { contractions: [0.25, 0.12, 0.06], pivot: 94, volumeDryUp: true, suggestedStop: 86.48 },
  peerCount: 12,
}

describe('MinerviniPanel', () => {
  it('gives a verdict, groups the criteria and shows entry and stop', () => {
    render(<MinerviniPanel analysis={analysis} />)
    expect(screen.getByRole('heading', { name: 'Trend rialzista, ma incompleto' })).toBeInTheDocument()
    expect(screen.getByText(/manca: criterio 8/)).toBeInTheDocument()
    expect(screen.getByText(/su 8 criteri/)).toBeInTheDocument()
    expect(screen.getByText('Stage 2')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '7 criteri soddisfatti su 8' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByLabelText('Criterio 8: non soddisfatto')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Contrazioni: 25%, 12%, 6%' })).toBeInTheDocument()
    expect(screen.getByText(/Possibile ingresso sopra 94,00, con stop a 86,48/)).toBeInTheDocument()
    expect(screen.getByText('Prezzo d’ingresso')).toBeInTheDocument()
    expect(screen.getByText('Stop loss')).toBeInTheDocument()
  })

  it('says to wait when the stock is not in an uptrend', () => {
    const down = { ...analysis, template: { ...analysis.template, passed: false, stage2: false, passedCount: 2 } }
    render(<MinerviniPanel analysis={down} />)
    expect(screen.getByRole('heading', { name: 'Non è in un trend rialzista' })).toBeInTheDocument()
    expect(screen.queryByText(/Possibile ingresso/)).not.toBeInTheDocument()
  })

  it('says when no VCP is detected', () => {
    render(<MinerviniPanel analysis={{ ...analysis, vcp: { contractions: [], pivot: null, volumeDryUp: false, suggestedStop: null } }} />)
    expect(screen.getByText(/Nessuna base VCP rilevata/)).toBeInTheDocument()
    expect(screen.getByText(/Nessun punto d’ingresso chiaro/)).toBeInTheDocument()
  })

  it('says the data is insufficient when there is no analysis', () => {
    render(<MinerviniPanel analysis={null} />)
    expect(screen.getByText(/Dati insufficienti/)).toBeInTheDocument()
  })
})
