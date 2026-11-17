import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AlertSwitch } from '@/components/AlertSwitch'
import { EMAIL_NOT_READY } from '@/components/AlertBell'

const ok = { ok: true, status: 200, json: () => Promise.resolve({}) }

describe('AlertSwitch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('is a switch labelled with what it does', () => {
    render(<AlertSwitch enabled={false} emailReady />)
    expect(screen.getByRole('switch', { name: /avvisami dei nuovi 8 su 8/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('turns on and saves the setting', async () => {
    ;(fetch as any).mockResolvedValue(ok)
    render(<AlertSwitch enabled={false} emailReady />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(fetch).toHaveBeenCalledWith('/api/scanner/alerts/settings', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ newEntrants: true }) }))
  })

  it('turns off when it was on', () => {
    ;(fetch as any).mockResolvedValue(ok)
    render(<AlertSwitch enabled emailReady />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(fetch).toHaveBeenCalledWith('/api/scanner/alerts/settings', expect.objectContaining({ body: JSON.stringify({ newEntrants: false }) }))
  })

  it('goes back and says so when the save fails', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    render(<AlertSwitch enabled={false} emailReady />)
    fireEvent.click(screen.getByRole('switch'))
    expect(await screen.findByRole('status')).toHaveTextContent(/non sono riuscito/i)
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'))
  })

  it('explains the evening scan in a tooltip', () => {
    render(<AlertSwitch enabled={false} emailReady />)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/ogni sera/i)
  })

  it('is disabled with the reason when email is not configured', () => {
    render(<AlertSwitch enabled={false} emailReady={false} />)
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('switch')).toHaveAttribute('title', EMAIL_NOT_READY)
  })
})
