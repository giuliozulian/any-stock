import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScannerSkeleton } from '@/app/scanner/ScannerSkeleton'

describe('ScannerSkeleton', () => {
  it('announces the loading to screen readers', () => {
    render(<ScannerSkeleton />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent('Carico lo scanner…')
  })

  it('hides the decorative bars and has nothing to click or read', () => {
    const { container } = render(<ScannerSkeleton />)
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('draws five placeholder rows like the real list', () => {
    const { container } = render(<ScannerSkeleton />)
    expect(container.querySelectorAll('li')).toHaveLength(5)
  })
})
