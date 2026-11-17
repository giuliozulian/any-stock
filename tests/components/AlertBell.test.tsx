import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AlertBell, EMAIL_NOT_READY } from '@/components/AlertBell'

const ok = { ok: true, status: 200, json: () => Promise.resolve({}) }
const unarmed = () => screen.getByRole('button', { name: 'Avvisami per email quando AAA arriva a 8 su 8' })
const armedButton = () => screen.getByRole('button', { name: 'Avviso attivo per AAA, clicca per disattivarlo' })

describe('AlertBell', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('arms the alert and shows it as on', async () => {
    ;(fetch as any).mockResolvedValue(ok)
    render(<AlertBell symbol="AAA" armed={false} emailReady />)
    expect(unarmed()).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(unarmed())
    expect(armedButton()).toHaveAttribute('aria-pressed', 'true')
    expect(fetch).toHaveBeenCalledWith('/api/scanner/alerts/AAA', { method: 'POST' })
  })

  it('disarms an armed alert', async () => {
    ;(fetch as any).mockResolvedValue(ok)
    render(<AlertBell symbol="AAA" armed emailReady />)
    fireEvent.click(armedButton())
    expect(unarmed()).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/scanner/alerts/AAA', { method: 'DELETE' })
  })

  it('goes back and says so when the server refuses', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    render(<AlertBell symbol="AAA" armed={false} emailReady />)
    fireEvent.click(unarmed())
    expect(await screen.findByRole('status')).toHaveTextContent(/non sono riuscito/i)
    expect(unarmed()).toHaveAttribute('aria-pressed', 'false')
  })

  it('goes back when the network fails', async () => {
    ;(fetch as any).mockRejectedValue(new Error('offline'))
    render(<AlertBell symbol="AAA" armed={false} emailReady />)
    fireEvent.click(unarmed())
    await waitFor(() => expect(unarmed()).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('lets the last click decide: a late failure of an old click does not undo it', async () => {
    let failFirst: (v: unknown) => void = () => {}
    ;(fetch as any)
      .mockImplementationOnce(() => new Promise((resolve) => { failFirst = resolve }))
      .mockResolvedValue(ok)
    render(<AlertBell symbol="AAA" armed={false} emailReady />)
    fireEvent.click(unarmed()) // arm, still pending
    fireEvent.click(armedButton()) // disarm
    fireEvent.click(unarmed()) // arm again
    expect(armedButton()).toBeInTheDocument()
    failFirst({ ok: false, status: 500, json: () => Promise.resolve({}) })
    await new Promise((r) => setTimeout(r, 0))
    expect(armedButton()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is disabled with the reason when email is not configured, and never calls the API', () => {
    render(<AlertBell symbol="AAA" armed={false} emailReady={false} />)
    expect(unarmed()).toBeDisabled()
    expect(unarmed()).toHaveAttribute('title', EMAIL_NOT_READY)
    fireEvent.click(unarmed())
    expect(fetch).not.toHaveBeenCalled()
  })
})
