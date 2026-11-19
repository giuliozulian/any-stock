import { connection } from 'next/server'
import { getAuthedUser, getRealUser, isAdminEmail } from '@/lib/auth'
import { SiteNav } from './SiteNav'

// Server wrapper: reads the session (cookies) inside the Suspense of the layout, as Cache Components require.
export async function SiteNavGate() {
  await connection()
  const real = await getRealUser()
  const user = await getAuthedUser()
  return <SiteNav signedIn={user !== null} isAdmin={isAdminEmail(real?.email)} viewingAs={user?.impersonatedBy ? user.email : null} email={real?.email ?? null} />
}
