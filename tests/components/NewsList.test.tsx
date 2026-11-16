import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NewsList } from '@/components/NewsList'

describe('NewsList', () => {
  it('renders a fallback message when there is no news', () => {
    render(<NewsList news={[]} />)
    expect(screen.getByText(/no recent news/i)).toBeInTheDocument()
  })

  it('renders each news item as a link', () => {
    render(
      <NewsList
        news={[
          { id: '1', headline: 'Apple hits new high', url: 'https://example.com/a', source: 'Reuters', publishedAt: new Date('2026-11-01') },
        ]}
      />
    )
    expect(screen.getByRole('link', { name: /apple hits new high/i })).toHaveAttribute('href', 'https://example.com/a')
  })

  it('moves low-relevance analysed items into a collapsed group', () => {
    const base = { url: 'https://e.com/', source: 'X', publishedAt: new Date('2026-11-01') }
    const analysis = (intensity: number) => ({
      id: 'a', digest: null, rationale: 'r', intensity, horizon: 'short', confidence: 'high', tone: 'neutral', direct: true,
    })
    render(
      <NewsList
        news={[
          { id: '1', headline: 'Big news', ...base, analysis: analysis(4) } as never,
          { id: '2', headline: 'Minor news', ...base, analysis: analysis(1) } as never,
        ]}
      />
    )
    expect(screen.getByText(/Minor news/).closest('details')).not.toBeNull()
    expect(screen.getByText(/Big news/).closest('details')).toBeNull()
  })
})
