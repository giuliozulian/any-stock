import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { login, logout } from '@/app/login/actions'

const client = vi.mocked(createSupabaseServerClient)
const signInWithPassword = vi.fn()
const signOut = vi.fn()

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}
const WRONG = { error: 'Email o password errati.' }

describe('login action', () => {
  beforeEach(() => {
    signInWithPassword.mockReset()
    signOut.mockReset().mockResolvedValue({})
    client.mockReset().mockResolvedValue({ auth: { signInWithPassword, signOut } } as never)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('signs in and goes where the visitor was heading', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1', email: 'me@example.com' } }, error: null })
    await expect(login({ error: null }, form({ email: ' me@example.com ', password: 'pw', next: '/scanner' }))).rejects.toThrow('REDIRECT:/scanner')
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'me@example.com', password: 'pw' })
  })

  it('goes home when "next" would leave the site or loop back to the login page', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1', email: 'me@example.com' } }, error: null })
    for (const next of ['//evil.com', 'https://evil.com', '/\\evil.com', '/login', '']) {
      await expect(login({ error: null }, form({ email: 'me@example.com', password: 'pw', next }))).rejects.toThrow('REDIRECT:/')
    }
  })

  it('gives one generic error for wrong credentials, without redirecting', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } })
    expect(await login({ error: null }, form({ email: 'me@example.com', password: 'bad' }))).toEqual(WRONG)
  })

  it('asks for both fields without calling Supabase', async () => {
    expect(await login({ error: null }, form({ email: '', password: 'pw' }))).toEqual({ error: 'Inserisci email e password.' })
    expect(await login({ error: null }, form({ email: 'me@example.com', password: '' }))).toEqual({ error: 'Inserisci email e password.' })
    expect(await login({ error: null }, new FormData())).toEqual({ error: 'Inserisci email e password.' })
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('says access is not configured, without calling Supabase', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    expect(await login({ error: null }, form({ email: 'me@example.com', password: 'pw' }))).toEqual({ error: 'Accesso non configurato.' })
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('gives a generic error, never the raw one, when Supabase fails', async () => {
    signInWithPassword.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:443'))
    const state = await login({ error: null }, form({ email: 'me@example.com', password: 'pw' }))
    expect(state).toEqual({ error: 'Non riesco ad accedere, riprova tra poco.' })
    expect(JSON.stringify(state)).not.toContain('ECONNREFUSED')
  })
})

describe('logout action', () => {
  beforeEach(() => {
    signOut.mockReset().mockResolvedValue({})
    client.mockReset().mockResolvedValue({ auth: { signInWithPassword, signOut } } as never)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('signs out and goes to the login page', async () => {
    await expect(logout()).rejects.toThrow('REDIRECT:/login')
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('goes to the login page even when Supabase fails or is not configured', async () => {
    signOut.mockRejectedValue(new Error('down'))
    await expect(logout()).rejects.toThrow('REDIRECT:/login')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    signOut.mockClear()
    await expect(logout()).rejects.toThrow('REDIRECT:/login')
    expect(signOut).not.toHaveBeenCalled()
  })
})
