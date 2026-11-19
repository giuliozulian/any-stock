import { Suspense } from 'react'
import { connection } from 'next/server'
import { notFound } from 'next/navigation'
import { SectionSkeleton } from '@/components/SectionSkeleton'
import { AuthGate } from '@/components/AuthGate'
import { getRealUser, isAdminEmail } from '@/lib/auth'
import { listUsers } from '@/lib/admin-users'
import styles from '../section.module.css'
import { startImpersonation } from './actions'

async function UserList() {
  await connection()
  const real = await getRealUser()
  if (!real || !isAdminEmail(real.email)) notFound()
  const users = await listUsers()
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Utenti</h2>
      <p className={styles.lead}>Entra nel profilo di un utente per vedere la sua watchlist e i suoi dati. Il banner in alto permette di tornare al tuo account.</p>
      {users === null ? (
        <p className={styles.empty}>Non riesco a leggere gli utenti: serve SUPABASE_SERVICE_ROLE_KEY tra le variabili d&apos;ambiente.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {users.map((u) => (
            <li key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <span>
                {u.email}
                {u.id === real.id && ' (tu)'}
                <small style={{ marginLeft: 12, opacity: 0.6 }}>{u.lastSignInAt ? `ultimo accesso ${new Date(u.lastSignInAt).toLocaleDateString('it-IT')}` : 'mai acceduto'}</small>
              </span>
              {u.id !== real.id && (
                <form action={startImpersonation}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button type="submit">Entra come</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function AdminPage() {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Utenti</h1>
      <Suspense fallback={<SectionSkeleton label="Carico gli utenti…" variant="list" />}>
        <AuthGate path="/admin">
          <UserList />
        </AuthGate>
      </Suspense>
    </main>
  )
}
