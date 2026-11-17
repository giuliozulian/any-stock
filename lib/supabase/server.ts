import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Supabase client bound to the cookies of the current request (route handlers, server actions and server components).
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
        } catch {
          // Called from a server component, where cookies are read-only: proxy.ts refreshes the session on every request.
        }
      },
    },
  })
}
