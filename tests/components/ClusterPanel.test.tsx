import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ClusterPanel } from '@/components/ClusterPanel'
import type { InsiderCluster } from '@/lib/insiders'

const trade = (name: string, role: string, date: string, value: number) => ({ name, side: 'buy' as const, shares: 1000, price: value / 1000, value, date, filingDate: date, role })

const CLUSTER: InsiderCluster = {
  from: '2026-11-10',
  to: '2026-11-17',
  insiders: 2,
  purchases: 2,
  total: 2_071_000,
  lead: { name: 'Weisenburger', role: 'Director', value: 1_980_000 },
  score: 78,
  trades: [trade('Corbett', 'CFO', '2026-11-17', 91_000), trade('Weisenburger', 'Director', '2026-11-10', 1_980_000)],
}

describe('ClusterPanel', () => {
  it('shows score, people, total, lead insider and each purchase', () => {
    render(<ClusterPanel cluster={CLUSTER} />)
    expect(screen.getByText('78')).toBeInTheDocument()
    expect(screen.getByText('$2.07M')).toBeInTheDocument()
    expect(screen.getByText(/Weisenburger · Director/)).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Corbett' })).toBeInTheDocument()
  })

  it('says so when there is no recent cluster', () => {
    render(<ClusterPanel cluster={null} />)
    expect(screen.getByText(/Nessun cluster recente/)).toBeInTheDocument()
  })
})
