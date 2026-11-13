import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { CompareSelectionProvider, CompareCheckbox, CompareBar } from '@/components/CompareSelection'

vi.mock('next/navigation', () => ({ useRouter: vi.fn() }))

function Harness({ symbols, maxCount = 4 }: { symbols: string[]; maxCount?: number }) {
  return (
    <CompareSelectionProvider>
      {symbols.map((s) => (
        <CompareCheckbox key={s} symbol={s} />
      ))}
      <CompareBar maxCount={maxCount} />
    </CompareSelectionProvider>
  )
}

describe('CompareSelection', () => {
  const push = vi.fn()

  beforeEach(() => {
    push.mockReset()
    ;(useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push })
  })

  it('hides the bar when nothing is selected', () => {
    render(<Harness symbols={['AAPL', 'MSFT']} />)
    expect(screen.queryByRole('button', { name: /confronta/i })).not.toBeInTheDocument()
  })

  it('disables the Confronta button with only 1 selected', () => {
    render(<Harness symbols={['AAPL', 'MSFT']} />)
    fireEvent.click(screen.getByLabelText('AAPL'))
    expect(screen.getByRole('button', { name: /confronta/i })).toBeDisabled()
  })

  it('enables the button and navigates with the selected symbols on click', () => {
    render(<Harness symbols={['AAPL', 'MSFT', 'GOOGL']} />)
    fireEvent.click(screen.getByLabelText('AAPL'))
    fireEvent.click(screen.getByLabelText('MSFT'))
    const button = screen.getByRole('button', { name: /confronta/i })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(push).toHaveBeenCalledWith('/confronta?symbols=AAPL,MSFT')
  })

  it('disables unselected checkboxes once 4 are selected', () => {
    render(<Harness symbols={['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA']} maxCount={4} />)
    fireEvent.click(screen.getByLabelText('AAPL'))
    fireEvent.click(screen.getByLabelText('MSFT'))
    fireEvent.click(screen.getByLabelText('GOOGL'))
    fireEvent.click(screen.getByLabelText('NVDA'))
    expect(screen.getByLabelText('TSLA')).toBeDisabled()
  })
})
