import { NextResponse, type NextRequest } from 'next/server'
import { authConfigured, authDisabled, isAllowedEmail } from '@/lib/auth-config'
import { updateSession } from '@/lib/supabase/proxy'

function toLogin(request: NextRequest, search: string): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = search
  return NextResponse.redirect(url)
}

// First, quick gate for pages. It is not the only check: every route handler calls requireUser() and every page goes through
// <AuthGate>. /api is not blocked here because the scanner routes also accept the cron secret, which only their handlers know.
export async function proxy(request: NextRequest) {
  if (authDisabled()) return NextResponse.next()

  const { pathname, search } = request.nextUrl
  const isApi = pathname.startsWith('/api/')

  if (!authConfigured()) return isApi ? NextResponse.next() : toLogin(request, '?error=config')

  let session: Awaited<ReturnType<typeof updateSession>>
  try {
    session = await updateSession(request)
  } catch {
    // Supabase unreachable: fail closed for pages, and let the handlers answer for the API.
    return isApi ? NextResponse.next() : toLogin(request, `?next=${encodeURIComponent(pathname + search)}`)
  }

  if (isApi) return session.response
  if (session.user && isAllowedEmail(session.user.email)) return session.response
  return toLogin(request, `?next=${encodeURIComponent(pathname + search)}`)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|pwa-icon|login|api/cron|api/widget|api/calendar).*)'],
}
