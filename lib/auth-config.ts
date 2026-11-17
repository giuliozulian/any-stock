let warned = false

export function resetAuthWarning(): void {
  warned = false
}

// AUTH_DISABLED opens the app for local development only: in production it is ignored, so it can never open a deployed app.
export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === '1' && process.env.NODE_ENV !== 'production'
}

export function warnAuthDisabled(): void {
  if (warned) return
  warned = true
  console.warn('AUTH_DISABLED=1: the app is open to everyone. Use it only on your own machine.')
}

export function authConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.AUTH_ALLOWED_EMAIL)
}

// AUTH_ALLOWED_EMAIL lists who may enter, separated by commas. A valid Supabase session of any other email is treated as no session at all.
export function allowedEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAIL ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  const mail = email?.trim().toLowerCase()
  return Boolean(mail && allowedEmails().includes(mail))
}
