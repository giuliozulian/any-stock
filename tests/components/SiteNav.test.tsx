import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/app/login/actions', () => ({ logout: vi.fn() }))

import { SiteNav } from '@/components/SiteNav'

describe('SiteNav', () => {
  it('marks the Minervini SCAN entry as new', () => {
    render(<SiteNav signedIn />)
    const scanner = screen.getByRole('link', { name: /minervini/i })
    expect(within(scanner).getByText('New')).toBeInTheDocument()
    expect(scanner).toHaveAttribute('href', '/scanner')
  })

  it('marks only the two newest entries', () => {
    render(<SiteNav signedIn />)
    expect(screen.getAllByText('New')).toHaveLength(2)
    expect(within(screen.getByRole('link', { name: /cluster insider|insider/i })).getByText('New')).toBeInTheDocument()
  })

  it('offers a way out when signed in', () => {
    render(<SiteNav signedIn />)
    expect(screen.getByRole('button', { name: 'Esci' })).toBeInTheDocument()
  })

  it('shows only the brand, with no menu and no way out, when signed out', () => {
    render(<SiteNav signedIn={false} />)
    expect(screen.queryByRole('button', { name: 'Esci' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /minervini/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')?.querySelectorAll('li')).toHaveLength(0)
    expect(screen.getByRole('link', { name: /any stock/i })).toBeInTheDocument()
  })
})

describe('SiteNav groups', () => {
  it('keeps Watchlist, Minervini and Scopri in view and puts the rest in two dropdowns', () => {
    render(<SiteNav signedIn />)
    expect(document.querySelectorAll('li[class*="primary"]')).toHaveLength(3)
    const mercato = screen.getByRole('button', { name: 'Mercato' })
    const compra = screen.getByRole('button', { name: 'Chi compra' })
    expect(within(screen.getByRole('list', { name: 'Mercato' })).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/movimenti', '/trimestrali', '/ipo'])
    expect(within(screen.getByRole('list', { name: 'Chi compra' })).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/politici', '/insider'])
    expect(mercato).toHaveAttribute('aria-expanded', 'false')
    expect(compra).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens one dropdown at a time and closes it on a click outside, Escape or a chosen entry', () => {
    render(<SiteNav signedIn />)
    fireEvent.click(screen.getByRole('button', { name: 'Mercato' }))
    expect(screen.getByRole('button', { name: 'Mercato' })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Chi compra' }))
    expect(screen.getByRole('button', { name: 'Mercato' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Chi compra' })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.pointerDown(document.body)
    expect(screen.getByRole('button', { name: 'Chi compra' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Mercato' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mercato' }), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Mercato' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Mercato' }))
    fireEvent.click(screen.getByRole('link', { name: /trimestrali/i }))
    expect(screen.getByRole('button', { name: 'Mercato' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('puts the account in an avatar on the right: the email, Admin only for an admin, and the way out', () => {
    const { unmount } = render(<SiteNav signedIn email="giulio@example.com" />)
    const avatar = screen.getByRole('button', { name: 'Account' })
    expect(avatar).toHaveTextContent('G')
    expect(avatar).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('giulio@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /admin/i })).not.toBeInTheDocument()
    fireEvent.click(avatar)
    expect(avatar).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerDown(document.body)
    expect(avatar).toHaveAttribute('aria-expanded', 'false')
    unmount()

    render(<SiteNav signedIn isAdmin email="giulio@example.com" />)
    expect(screen.getByRole('link', { name: /admin/i })).toHaveAttribute('href', '/admin')
    expect(screen.getByRole('button', { name: 'Esci' })).toBeInTheDocument()
  })

  it('opens the account and a group one at a time', () => {
    render(<SiteNav signedIn email="a@b.c" />)
    fireEvent.click(screen.getByRole('button', { name: 'Mercato' }))
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    expect(screen.getByRole('button', { name: 'Mercato' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Account' })).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('SiteNav on a phone', () => {
  it('opens the groups from a Menu button and closes with a chosen entry or Escape', () => {
    render(<SiteNav signedIn />)
    const menu = screen.getByRole('button', { name: 'Menu' })
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Chi compra', { selector: 'span' })).toBeInTheDocument()

    fireEvent.click(menu)
    expect(screen.getByRole('button', { name: 'Chiudi' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('link', { name: /politici/i }))
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Chiudi' }), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false')
  })
})
