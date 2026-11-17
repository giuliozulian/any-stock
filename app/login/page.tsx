import { Suspense } from 'react'
import { connection } from 'next/server'
import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { safeNext } from '@/lib/safe-next'
import { LoginChart } from './LoginChart'
import { LoginForm } from './LoginForm'
import styles from './page.module.css'

async function LoginGate({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  await connection()
  const { next, error } = await searchParams
  const target = safeNext(next)
  if (await getAuthedUser()) redirect(target)
  return (
    <>
      {error === 'config' && (
        <p role="alert" className={styles.config}>
          Accesso non configurato. In <code>.env.local</code> mancano <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> o <code>AUTH_ALLOWED_EMAIL</code>.
        </p>
      )}
      <LoginForm next={target} />
    </>
  )
}

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  return (
    <main className={styles.shell}>
      <div className={styles.content}>
        <h1 className={styles.title}>Accedi</h1>
        <p className={styles.lead}>Titoli, prezzi di ingresso e avvisi sono visibili solo a te.</p>
        <Suspense fallback={null}>
          <LoginGate searchParams={searchParams} />
        </Suspense>
      </div>
      <LoginChart />
    </main>
  )
}
