import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refreshes the Supabase session on the way in: if the access token was renewed, the new cookies are set on both the request
// (so the page sees them) and the response (so the browser stores them). Returns the validated user, or null.
export async function updateSession(request: NextRequest): Promise<{ response: NextResponse; user: { email?: string | null } | null }> {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
      },
    },
  })
  // getUser() validates the token with the Supabase server; getSession() would trust the cookie.
  const { data } = await supabase.auth.getUser()
  return { response, user: data.user }
}
