import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/supabase/proxy', () => ({ updateSession: vi.fn() }))

import { updateSession } from '@/lib/supabase/proxy'
import { config, proxy } from '@/proxy'

const update = vi.mocked(updateSession)
const forwarded = () => NextResponse.next()
const signedIn = (email: string | null) => {
  const response = forwarded()
  update.mockResolvedValue({ response, user: email === null ? null : { email } })
  return response
}
const req = (path: string) => new NextRequest(`http://localhost${path}`)

function configure() {
  vi.stubEnv('AUTH_DISABLED', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  vi.stubEnv('AUTH_ALLOWED_EMAIL', 'me@example.com')
}

describe('proxy', () => {
  beforeEach(() => {
    update.mockReset()
    configure()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('lets a signed-in allowed user through and returns the response that carries the refreshed cookies', async () => {
    const response = signedIn('me@example.com')
    expect(await proxy(req('/scanner'))).toBe(response)
  })

  it('sends a visitor to the login page, remembering the page and its query', async () => {
    signedIn(null)
    const res = await proxy(req('/scanner?a=1'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/login?next=%2Fscanner%3Fa%3D1')
  })

  it('treats a valid session of another email like no session', async () => {
    signedIn('stranger@example.com')
    const res = await proxy(req('/'))
    expect(res.headers.get('location')).toBe('http://localhost/login?next=%2F')
  })

  it('treats a failing session refresh as no session', async () => {
    update.mockRejectedValue(new Error('network down'))
    const res = await proxy(req('/'))
    expect(res.headers.get('location')).toContain('/login')
  })

  it('does not block /api: every handler enforces its own check, so the cron secret can reach the scanner routes', async () => {
    const response = signedIn(null)
    expect(await proxy(req('/api/scanner'))).toBe(response)
  })

  it('still refreshes the session on /api requests', async () => {
    signedIn('me@example.com')
    await proxy(req('/api/stocks'))
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('sends pages of an unconfigured app to the login page with the config error, and does not ask Supabase', async () => {
    vi.stubEnv('AUTH_ALLOWED_EMAIL', '')
    const res = await proxy(req('/scanner'))
    expect(res.headers.get('location')).toBe('http://localhost/login?error=config')
    expect(update).not.toHaveBeenCalled()
  })

  it('leaves /api to its handlers, which answer 503, when the app is unconfigured', async () => {
    vi.stubEnv('AUTH_ALLOWED_EMAIL', '')
    const res = await proxy(req('/api/stocks'))
    expect(res.headers.get('location')).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('opens everything when disabled outside production', async () => {
    vi.stubEnv('AUTH_DISABLED', '1')
    vi.stubEnv('NODE_ENV', 'development')
    const res = await proxy(req('/scanner'))
    expect(res.headers.get('location')).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('ignores AUTH_DISABLED in production', async () => {
    vi.stubEnv('AUTH_DISABLED', '1')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_ALLOWED_EMAIL', '')
    const res = await proxy(req('/scanner'))
    expect(res.headers.get('location')).toBe('http://localhost/login?error=config')
  })
})

describe('proxy matcher', () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`)
  const runs = (path: string) => matcher.test(path)

  it('covers the pages and the API', () => {
    for (const path of ['/', '/scanner', '/stock/AAPL', '/scopri', '/api/stocks', '/api/scanner/step', '/api/quotes']) {
      expect(runs(path)).toBe(true)
    }
  })

  it('skips the login page, the static files, the PWA files and the token or secret protected feeds', () => {
    for (const path of [
      '/login',
      '/_next/static/chunks/app.js',
      '/_next/image',
      '/favicon.ico',
      '/icon.svg',
      '/manifest.webmanifest',
      '/pwa-icon/180',
      '/api/cron/refresh',
      '/api/widget',
      '/api/calendar',
    ]) {
      expect(runs(path)).toBe(false)
    }
  })
})
