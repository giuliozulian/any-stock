import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CHART_CHECKS, ChartChecklist } from '@/components/ChartChecklist'

describe('ChartChecklist', () => {
  it('tells the user what to verify on the chart, one item per check', () => {
    render(<ChartChecklist />)
    expect(screen.getByRole('heading', { name: /controlla sul grafico/i })).toBeInTheDocument()
    for (const c of CHART_CHECKS) expect(screen.getByText(c.title, { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/oscillazioni si stringono/i)).toBeInTheDocument()
    expect(screen.getByText(/scambi calano nella base/i)).toBeInTheDocument()
    expect(screen.getByText(/uno dei primi tre punti non torna, aspetta/i)).toBeInTheDocument()
  })
})
