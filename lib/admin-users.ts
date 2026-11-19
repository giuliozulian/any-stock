export interface AdminUser {
  id: string
  email: string
  lastSignInAt: string | null
}

function adminApi(path: string): { url: string; headers: Record<string, string> } | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null
  return { url: `${base.replace(/\/+$/, '')}/auth/v1/admin/users${path}`, headers: { apikey: key, Authorization: `Bearer ${key}` } }
}

type RawUser = { id?: string; email?: string; last_sign_in_at?: string | null }

// Needs SUPABASE_SERVICE_ROLE_KEY: null when it is missing or Supabase refuses.
export async function listUsers(): Promise<AdminUser[] | null> {
  const req = adminApi('?per_page=200')
  if (!req) return null
  try {
    const res = await fetch(req.url, { headers: req.headers, cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { users?: RawUser[] }
    return (body.users ?? [])
      .filter((u): u is RawUser & { id: string; email: string } => Boolean(u.id && u.email))
      .map((u) => ({ id: u.id, email: u.email, lastSignInAt: u.last_sign_in_at ?? null }))
      .sort((a, b) => a.email.localeCompare(b.email))
  } catch {
    return null
  }
}

export async function findUser(id: string): Promise<AdminUser | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const req = adminApi(`/${id}`)
  if (!req) return null
  try {
    const res = await fetch(req.url, { headers: req.headers, cache: 'no-store' })
    if (!res.ok) return null
    const u = (await res.json()) as RawUser
    return u.id && u.email ? { id: u.id, email: u.email, lastSignInAt: u.last_sign_in_at ?? null } : null
  } catch {
    return null
  }
}
