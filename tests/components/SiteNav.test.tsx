import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SiteNav } from '@/components/SiteNav'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

describe('SiteNav', () => {
  it('marks the Scanner entry as new', () => {
    render(<SiteNav />)
    const scanner = screen.getByRole('link', { name: /scanner/i })
    expect(within(scanner).getByText('New')).toBeInTheDocument()
    expect(scanner).toHaveAttribute('href', '/scanner')
  })

  it('does not mark the other entries', () => {
    render(<SiteNav />)
    expect(screen.getAllByText('New')).toHaveLength(1)
  })
})
