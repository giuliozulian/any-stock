import { Suspense } from 'react'
import { connection } from 'next/server'
import { prisma } from '@/lib/db'
import { ScanButton } from '@/components/ScanButton'
import { CandidateCard } from '@/components/CandidateCard'
import styles from './page.module.css'

async function Candidates() {
  await connection()
  const latest = await prisma.discoveredCandidate.aggregate({ _max: { scannedAt: true } })
  const scannedAt = latest._max.scannedAt

  if (!scannedAt) {
    return <p className={styles.empty}>Nessuno scan ancora eseguito. Premi "Scansiona ora" per iniziare.</p>
  }

  const candidates = await prisma.discoveredCandidate.findMany({
    where: { scannedAt, dismissedAt: null },
    orderBy: { score: 'desc' },
  })

  return (
    <>
      <p className={styles.scannedAt}>
        Ultimo scan: {scannedAt.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })} alle{' '}
        {scannedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
      </p>
      {candidates.length === 0 ? (
        <p className={styles.empty}>Nessun candidato trovato in questo scan (o li hai già scartati tutti).</p>
      ) : (
        candidates.map((c) => (
          <CandidateCard
            key={c.symbol}
            candidate={{ symbol: c.symbol, name: c.name, market: c.market as 'US' | 'IT', score: c.score, reason: c.reason, partial: c.partial }}
          />
        ))
      )}
    </>
  )
}

export default function DiscoverPage() {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Scopri nuovi titoli</h1>
      <ScanButton />
      <Suspense fallback={<p className={styles.empty}>Carico i candidati…</p>}>
        <Candidates />
      </Suspense>
    </main>
  )
}
