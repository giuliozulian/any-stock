import { cache } from 'react'
import { redirect } from 'next/navigation'
import { authConfigured, authDisabled, warnAuthDisabled } from '@/lib/auth-config'
import { safeEqual } from '@/lib/safe-equal'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export { authConfigured, authDisabled } from '@/lib/auth-config'

export interface AuthedUser {
  id: string
  email: string
}

export type AuthResult = { ok: true } | { ok: false; response: Response }

async function fetchUser(): Promise<AuthedUser | null> {
  if (authDisabled()) {
    warnAuthDisabled()
    return { id: 'dev', email: 'dev@local' }
  }
  if (!authConfigured()) return null
  try {
    const supabase = await createSupabaseServerClient()
    // getUser() asks the Supabase server to validate the token; getSession() would trust the cookie as it is.
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user || !data.user.email) return null
    return { id: data.user.id, email: data.user.email }
  } catch (err) {
    console.error('Auth check failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

// One check per request: layout and page share the result.
export const getAuthedUser = cache(fetchUser)

function hasCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  const header = request.headers.get('authorization')
  return Boolean(secret && header && safeEqual(header, `Bearer ${secret}`))
}

// First line of every protected route handler. `allowCron` also accepts `Authorization: Bearer <CRON_SECRET>` for the routes
// the evening workflow calls.
export async function requireUser(request?: Request, options: { allowCron?: boolean } = {}): Promise<AuthResult> {
  if (authDisabled()) {
    warnAuthDisabled()
    return { ok: true }
  }
  if (!authConfigured()) return { ok: false, response: Response.json({ error: 'Auth not configured' }, { status: 503 }) }
  if (options.allowCron && request && hasCronSecret(request)) return { ok: true }
  if (!(await getAuthedUser())) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { ok: true }
}

// For pages. `path` is where to come back to after logging in.
export async function requireUserOrRedirect(path = '/'): Promise<void> {
  if (authDisabled()) {
    warnAuthDisabled()
    return
  }
  if (!authConfigured()) redirect('/login?error=config')
  if (!(await getAuthedUser())) redirect(`/login?next=${encodeURIComponent(path)}`)
}
