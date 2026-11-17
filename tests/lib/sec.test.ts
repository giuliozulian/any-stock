import { afterEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_SEC_UA, resetSecWarning, secUserAgent } from '@/lib/sec'

describe('secUserAgent', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    resetSecWarning()
  })

  it('declares the contact address the SEC asks for', () => {
    vi.stubEnv('SEC_CONTACT_EMAIL', 'me@example.com')
    expect(secUserAgent()).toBe('any-stock/1.0 (contact: me@example.com)')
  })

  it('trims the address', () => {
    vi.stubEnv('SEC_CONTACT_EMAIL', '  me@example.com ')
    expect(secUserAgent()).toBe('any-stock/1.0 (contact: me@example.com)')
  })

  it('falls back to the old agent when no contact is set, and says so only once', () => {
    vi.stubEnv('SEC_CONTACT_EMAIL', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(secUserAgent()).toBe(FALLBACK_SEC_UA)
    expect(secUserAgent()).toBe(FALLBACK_SEC_UA)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('SEC_CONTACT_EMAIL')
  })

  it('does not warn when the contact is set', () => {
    vi.stubEnv('SEC_CONTACT_EMAIL', 'me@example.com')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    secUserAgent()
    expect(warn).not.toHaveBeenCalled()
  })
})
