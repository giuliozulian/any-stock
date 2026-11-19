import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (cookieJar.value ? { value: cookieJar.value } : undefined) }) }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuthedUser, requireUser, requireUserOrRedirect } from '@/lib/auth'
import { resetAuthWarning } from '@/lib/auth-config'

const client = vi.mocked(createSupabaseServerClient)
const withUser = (email: string | null, error: unknown = null) =>
  client.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: email === null ? null : { id: 'u1', email } }, error }) },
  } as never)

function configure() {
  vi.stubEnv('AUTH_DISABLED', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  vi.stubEnv('CRON_SECRET', 's3cret')
}

const req = (authorization?: string) => new Request('http://localhost/api/x', { method: 'POST', headers: authorization ? { authorization } : {} })
const statusOf = async (r: Awaited<ReturnType<typeof requireUser>>) => (r.ok ? 200 : r.response.status)

describe('auth', () => {
  beforeEach(() => {
    client.mockReset()
    configure()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    resetAuthWarning()
  })

  describe('getAuthedUser', () => {
    it('returns the user when the session is valid', async () => {
      withUser('Me@Example.com')
      expect(await getAuthedUser()).toEqual({ id: 'u1', email: 'Me@Example.com' })
    })

    it('returns null without a session', async () => {
      withUser(null)
      expect(await getAuthedUser()).toBeNull()
    })

    it('returns null when Supabase reports an error', async () => {
      withUser('me@example.com', { message: 'jwt expired' })
      expect(await getAuthedUser()).toBeNull()
    })

    it('returns null, and does not throw, when Supabase cannot be reached', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      client.mockRejectedValue(new Error('network down'))
      expect(await getAuthedUser()).toBeNull()
    })

    it('returns null when auth is not configured, without calling Supabase', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
      expect(await getAuthedUser()).toBeNull()
      expect(client).not.toHaveBeenCalled()
    })

    it('returns a local user when auth is disabled outside production', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubEnv('AUTH_DISABLED', '1')
      vi.stubEnv('NODE_ENV', 'development')
      expect(await getAuthedUser()).toEqual({ id: 'dev', email: 'dev@local' })
      expect(client).not.toHaveBeenCalled()
    })
  })

  describe('requireUser', () => {
    it('lets a signed-in user through', async () => {
      withUser('me@example.com')
      expect(await requireUser()).toEqual({ ok: true })
    })

    it('answers 401 without a session', async () => {
      withUser(null)
      const r = await requireUser()
      expect(await statusOf(r)).toBe(401)
      if (!r.ok) expect(await r.response.json()).toEqual({ error: 'Unauthorized' })
    })

    it('answers 503, never lets through, when auth is not configured', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
      const r = await requireUser()
      expect(await statusOf(r)).toBe(503)
      if (!r.ok) expect(await r.response.json()).toEqual({ error: 'Auth not configured' })
      expect(client).not.toHaveBeenCalled()
    })

    it('ignores AUTH_DISABLED in production and answers 503 when unconfigured', async () => {
      vi.stubEnv('AUTH_DISABLED', '1')
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
      expect(await statusOf(await requireUser())).toBe(503)
    })

    it('lets everyone through, with a warning, when disabled outside production', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubEnv('AUTH_DISABLED', '1')
      vi.stubEnv('NODE_ENV', 'development')
      expect(await requireUser()).toEqual({ ok: true })
      expect(warn).toHaveBeenCalled()
    })

    it('accepts the cron secret only where allowCron is set', async () => {
      withUser(null)
      expect(await statusOf(await requireUser(req('Bearer s3cret'), { allowCron: true }))).toBe(200)
      expect(await statusOf(await requireUser(req('Bearer s3cret')))).toBe(401)
    })

    it('refuses a wrong, partial, missing or empty cron secret', async () => {
      withUser(null)
      for (const header of ['Bearer wrong', 'Bearer s3cre', 's3cret', 'Bearer ', undefined]) {
        expect(await statusOf(await requireUser(req(header), { allowCron: true }))).toBe(401)
      }
    })

    it('never accepts an empty bearer when CRON_SECRET is unset', async () => {
      withUser(null)
      vi.stubEnv('CRON_SECRET', '')
      expect(await statusOf(await requireUser(req('Bearer '), { allowCron: true }))).toBe(401)
      expect(await statusOf(await requireUser(req('Bearer undefined'), { allowCron: true }))).toBe(401)
    })
  })

  describe('requireUserOrRedirect', () => {
    it('returns for a signed-in user', async () => {
      withUser('me@example.com')
      await expect(requireUserOrRedirect('/scanner')).resolves.toBeUndefined()
    })

    it('sends a visitor to the login page remembering where they were going', async () => {
      withUser(null)
      await expect(requireUserOrRedirect('/stock/AAPL?tab=1')).rejects.toThrow('REDIRECT:/login?next=%2Fstock%2FAAPL%3Ftab%3D1')
    })

    it('defaults to the home page', async () => {
      withUser(null)
      await expect(requireUserOrRedirect()).rejects.toThrow('REDIRECT:/login?next=%2F')
    })

    it('sends an unconfigured app to the login page, which explains what is missing', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
      await expect(requireUserOrRedirect('/scanner')).rejects.toThrow('REDIRECT:/login?error=config')
    })

    it('returns without a check when disabled outside production', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubEnv('AUTH_DISABLED', '1')
      vi.stubEnv('NODE_ENV', 'development')
      await expect(requireUserOrRedirect('/scanner')).resolves.toBeUndefined()
    })
  })

  describe('impersonation', () => {
    beforeEach(() => {
      vi.stubEnv('ADMIN_EMAIL', 'Boss@x.com')
      cookieJar.value = 'target-id|user@x.com'
    })
    afterEach(() => {
      cookieJar.value = undefined
    })

    it('lets the admin act as the user in the cookie', async () => {
      withUser('boss@x.com')
      expect(await getAuthedUser()).toEqual({ id: 'target-id', email: 'user@x.com', impersonatedBy: 'boss@x.com' })
    })

    it('ignores the cookie for anyone else', async () => {
      withUser('mallory@x.com')
      expect(await getAuthedUser()).toEqual({ id: 'u1', email: 'mallory@x.com' })
    })
  })
})
