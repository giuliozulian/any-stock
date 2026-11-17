import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }))
vi.mock('@/lib/auth', () => ({ requireUserOrRedirect: vi.fn() }))

import { AuthGate } from '@/components/AuthGate'
import { requireUserOrRedirect } from '@/lib/auth'

const check = vi.mocked(requireUserOrRedirect)

describe('AuthGate', () => {
  // Braces matter: returning the mock from beforeEach would make vitest call it as a cleanup function.
  beforeEach(() => {
    check.mockReset()
  })

  it('renders its children once the check passes, and checks for the given path', async () => {
    check.mockResolvedValue(undefined)
    render(await AuthGate({ path: '/scanner', children: <p>contenuto privato</p> }))
    expect(screen.getByText('contenuto privato')).toBeInTheDocument()
    expect(check).toHaveBeenCalledWith('/scanner')
  })

  it('never renders its children when the check redirects', async () => {
    check.mockRejectedValue(new Error('REDIRECT:/login'))
    await expect(AuthGate({ path: '/scanner', children: <p>contenuto privato</p> })).rejects.toThrow('REDIRECT:/login')
  })
})
