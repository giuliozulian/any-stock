import { afterEach, describe, expect, it, vi } from 'vitest'
import { authConfigured, authDisabled, resetAuthWarning, warnAuthDisabled } from '@/lib/auth-config'

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
  it('needs the URL and the anon key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
    expect(authConfigured()).toBe(true)
    for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
      vi.stubEnv(name, '')
      expect(authConfigured()).toBe(false)
      vi.unstubAllEnvs()
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
      }
  })
})
