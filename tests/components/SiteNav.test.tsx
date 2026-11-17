import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/app/login/actions', () => ({ logout: vi.fn() }))

import { SiteNav } from '@/components/SiteNav'

describe('SiteNav', () => {
  it('marks the Scanner entry as new', () => {
    render(<SiteNav signedIn />)
    const scanner = screen.getByRole('link', { name: /scanner/i })
    expect(within(scanner).getByText('New')).toBeInTheDocument()
    expect(scanner).toHaveAttribute('href', '/scanner')
  })

  it('does not mark the other entries', () => {
    render(<SiteNav signedIn />)
    expect(screen.getAllByText('New')).toHaveLength(1)
  })

  it('offers a way out when signed in', () => {
    render(<SiteNav signedIn />)
    expect(screen.getByRole('button', { name: 'Esci' })).toBeInTheDocument()
  })

  it('shows only the brand, with no menu and no way out, when signed out', () => {
    render(<SiteNav signedIn={false} />)
    expect(screen.queryByRole('button', { name: 'Esci' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /scanner/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')?.querySelectorAll('li')).toHaveLength(0)
    expect(screen.getByRole('link', { name: /any stock/i })).toBeInTheDocument()
  })
})
