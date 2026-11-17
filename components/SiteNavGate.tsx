import { connection } from 'next/server'
import { getAuthedUser } from '@/lib/auth'
import { SiteNav } from './SiteNav'

// Server wrapper: reads the session (cookies) inside the Suspense of the layout, as Cache Components require.
export async function SiteNavGate() {
  await connection()
  return <SiteNav signedIn={(await getAuthedUser()) !== null} />
}
