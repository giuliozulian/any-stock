import { connection } from 'next/server'
import { requireUserOrRedirect } from '@/lib/auth'

// Second line of defence behind proxy.ts: a page renders its data only after the session has been checked again.
// It sits inside the page's <Suspense> because Cache Components do not allow reading cookies outside one.
export async function AuthGate({ path, children }: { path: string; children: React.ReactNode }) {
  await connection()
  await requireUserOrRedirect(path)
  return <>{children}</>
}
