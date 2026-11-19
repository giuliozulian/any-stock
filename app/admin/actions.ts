'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { IMPERSONATE_COOKIE, getRealUser, isAdminEmail } from '@/lib/auth'
import { findUser } from '@/lib/admin-users'

// Re-checks the admin on every call: a server action is a public POST endpoint.
export async function startImpersonation(formData: FormData): Promise<void> {
  const real = await getRealUser()
  if (!real || !isAdminEmail(real.email)) redirect('/')
  const target = await findUser(String(formData.get('userId') ?? ''))
  if (!target) redirect('/admin?error=notfound')
  const store = await cookies()
  store.set(IMPERSONATE_COOKIE, `${target.id}|${target.email}`, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 4 })
  redirect('/')
}

export async function stopImpersonation(): Promise<void> {
  ;(await cookies()).delete(IMPERSONATE_COOKIE)
  redirect('/admin')
}
