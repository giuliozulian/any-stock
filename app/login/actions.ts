'use server'

import { redirect } from 'next/navigation'
import { authConfigured } from '@/lib/auth-config'
import { safeNext } from '@/lib/safe-next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { LoginState } from './state'

// One message for every failed login: nothing tells a wrong password from an unknown account.
const WRONG = 'Email o password errati.'

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = safeNext(String(formData.get('next') ?? ''))
  if (!email || !password) return { error: 'Inserisci email e password.' }
  if (!authConfigured()) return { error: 'Accesso non configurato.' }

  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) return { error: WRONG }
  } catch {
    return { error: 'Non riesco ad accedere, riprova tra poco.' }
  }
  // Outside the try: redirect() works by throwing, and the catch would swallow it.
  redirect(next)
}

export async function logout(): Promise<void> {
  if (authConfigured()) {
    try {
      const supabase = await createSupabaseServerClient()
      await supabase.auth.signOut()
    } catch {
      // Leaving anyway: the login page is where a signed-out visitor belongs.
    }
  }
  redirect('/login')
}
