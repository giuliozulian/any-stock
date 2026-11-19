import { Suspense } from 'react'
import { connection } from 'next/server'
import { notFound } from 'next/navigation'
import { SectionSkeleton } from '@/components/SectionSkeleton'
import { AuthGate } from '@/components/AuthGate'
import { getRealUser, isAdminEmail } from '@/lib/auth'
import { listUsers } from '@/lib/admin-users'
import styles from './admin.module.css'
import { startImpersonation } from './actions'

const DAY_MS = 24 * 60 * 60 * 1000

function lastSeen(iso: string | null): string {
  if (!iso) return 'Non è ancora entrato'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS)
  if (days <= 0) return 'Ultimo accesso oggi'
  if (days === 1) return 'Ultimo accesso ieri'
  if (days < 30) return `Ultimo accesso ${days} giorni fa`
  return `Ultimo accesso il ${new Date(iso).toLocaleDateString('it-IT')}`
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

async function UserList({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection()
  const real = await getRealUser()
  if (!real || !isAdminEmail(real.email)) notFound()
  const { error } = await searchParams
  const users = await listUsers()
  const sorted = users ? [...users].sort((a, b) => (b.lastSignInAt ?? '').localeCompare(a.lastSignInAt ?? '')) : null

  return (
    <section>
      <div className={styles.sectionHead}>
        <h2 className={styles.heading}>Utenti</h2>
        {sorted && <span className={styles.count}>{sorted.length === 1 ? '1 utente' : `${sorted.length} utenti`}</span>}
      </div>
      <p className={styles.lead}>Scegli un utente per vedere l&apos;app come la vede lui: watchlist, scanner e avvisi. In alto trovi sempre il pulsante per tornare al tuo account.</p>
      {error === 'notfound' && (
        <p role="alert" className={styles.notice}>
          Utente non trovato. Aggiorna la pagina e riprova.
        </p>
      )}
      {sorted === null ? (
        <p role="alert" className={styles.notice}>
          Non riesco a leggere gli utenti. Aggiungi <code>SUPABASE_SERVICE_ROLE_KEY</code> alle variabili d&apos;ambiente e riavvia l&apos;app.
        </p>
      ) : (
        <ul className={styles.list}>
          {sorted.map((u) => {
            const me = u.id === real.id
            return (
              <li key={u.id} className={`${styles.row} ${me ? styles.me : ''}`}>
                <span className={styles.avatar} aria-hidden="true">
                  {u.email[0]}
                </span>
                <div className={styles.who}>
                  <div className={styles.email}>
                    <span>{u.email}</span>
                    {me && <span className={styles.tag}>Tu</span>}
                  </div>
                  <div className={styles.meta}>{lastSeen(u.lastSignInAt)}</div>
                </div>
                {!me && (
                  <form action={startImpersonation}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button type="submit" className={styles.enter} aria-label={`Entra come ${u.email}`}>
                      <EyeIcon />
                      Entra come
                    </button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <Suspense fallback={<SectionSkeleton label="Carico gli utenti…" variant="list" rows={4} />}>
      <AuthGate path="/admin">
        <UserList searchParams={searchParams} />
      </AuthGate>
    </Suspense>
  )
}
