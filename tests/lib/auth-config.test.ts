import { afterEach, describe, expect, it, vi } from 'vitest'
import { authConfigured, authDisabled, isAllowedEmail, resetAuthWarning, warnAuthDisabled } from '@/lib/auth-config'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetAuthWarning()
})

describe('authDisabled', () => {
  it('is on only with AUTH_DISABLED=1 outside production', () => {
    vi.stubEnv('AUTH_DISABLED', '1')
    vi.stubEnv('NODE_ENV', 'development')
    expect(authDisabled()).toBe(true)
    vi.stubEnv('NODE_ENV', 'test')
    expect(authDisabled()).toBe(true)
  })

  it('is ignored in production, so a stray variable cannot open a deployed app', () => {
    vi.stubEnv('AUTH_DISABLED', '1')
    vi.stubEnv('NODE_ENV', 'production')
    expect(authDisabled()).toBe(false)
  })

  it('is off for any other value', () => {
    vi.stubEnv('NODE_ENV', 'development')
    for (const v of ['', '0', 'true', 'yes']) {
      vi.stubEnv('AUTH_DISABLED', v)
      expect(authDisabled()).toBe(false)
    }
  })
})

describe('authConfigured', () => {
  it('needs the URL, the anon key and the allowed email', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
    vi.stubEnv('AUTH_ALLOWED_EMAIL', 'me@example.com')
    expect(authConfigured()).toBe(true)
    for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'AUTH_ALLOWED_EMAIL']) {
      vi.stubEnv(name, '')
      expect(authConfigured()).toBe(false)
      vi.unstubAllEnvs()
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
      vi.stubEnv('AUTH_ALLOWED_EMAIL', 'me@example.com')
    }
  })
})

describe('isAllowedEmail', () => {
  it('matches the allowed email ignoring case and spaces', () => {
    vi.stubEnv('AUTH_ALLOWED_EMAIL', ' Me@Example.com ')
    expect(isAllowedEmail('me@example.com')).toBe(true)
    expect(isAllowedEmail(' ME@EXAMPLE.COM ')).toBe(true)
  })

  it('accepts any email of a comma-separated list, and nothing outside it', () => {
    vi.stubEnv('AUTH_ALLOWED_EMAIL', 'me@example.com, Friend@Example.com ,')
    expect(isAllowedEmail('friend@example.com')).toBe(true)
    expect(isAllowedEmail('me@example.com')).toBe(true)
    expect(isAllowedEmail('')).toBe(false)
    expect(isAllowedEmail('stranger@example.com')).toBe(false)
  })

  it('refuses another email, an empty one and a missing configuration', () => {
    vi.stubEnv('AUTH_ALLOWED_EMAIL', 'me@example.com')
    expect(isAllowedEmail('other@example.com')).toBe(false)
    expect(isAllowedEmail('')).toBe(false)
    expect(isAllowedEmail(null)).toBe(false)
    expect(isAllowedEmail(undefined)).toBe(false)
    vi.stubEnv('AUTH_ALLOWED_EMAIL', '')
    expect(isAllowedEmail('me@example.com')).toBe(false)
  })
})

describe('warnAuthDisabled', () => {
  it('warns once, mentioning AUTH_DISABLED', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnAuthDisabled()
    warnAuthDisabled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('AUTH_DISABLED')
  })
})
