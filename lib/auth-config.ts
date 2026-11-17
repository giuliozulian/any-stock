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
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
