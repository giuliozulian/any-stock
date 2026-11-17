import { Suspense } from 'react'
import { SectionSkeleton } from '@/components/SectionSkeleton'
import { connection } from 'next/server'
import { prisma } from '@/lib/db'
import { ScanButton } from '@/components/ScanButton'
import { CandidateCard } from '@/components/CandidateCard'
import styles from '../section.module.css'
import local from './page.module.css'
import { AuthGate } from '@/components/AuthGate'

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
      <p className={local.scannedAt}>
        Ultimo scan: {scannedAt.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })} alle{' '}
        {scannedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
      </p>
      {candidates.length === 0 ? (
        <p className={styles.empty}>Nessun candidato trovato in questo scan (o li hai già scartati tutti).</p>
      ) : (
        candidates.map((c) => (
          <CandidateCard
            key={c.symbol}
            candidate={{ symbol: c.symbol, name: c.name, market: c.market as 'US' | 'IT', score: c.score, momentumScore: c.momentumScore, fundamentalsScore: c.fundamentalsScore, insiderScore: c.insiderScore, reason: c.reason, aiVerdict: c.aiVerdict === 'solid' || c.aiVerdict === 'caution' ? c.aiVerdict : null, aiNote: c.aiNote, partial: c.partial, source: c.source }}
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
      <section className={styles.section}>
        <p className={styles.lead}>
          "Scansiona ora" cerca titoli nuovi (non ancora nella tua watchlist) tra i più mossi di oggi in USA e Italia e tra gli acquisti recenti dei politici USA.
          Ogni titolo riceve un punteggio da 0 a 100, media di tre parti: <strong>Andamento</strong> (prezzo recente), <strong>Conti</strong> (solidità dell'azienda) e{' '}
          <strong>Insider</strong> (acquisti di dirigenti e politici, solo USA). Più è alto, più vale la pena approfondire: non è un consiglio d'acquisto.
          La scansione usa chiamate a servizi esterni e può richiedere fino a un minuto.
        </p>
        <ScanButton />
        <Suspense fallback={<SectionSkeleton label="Carico i candidati…" variant="cards" />}>
          <AuthGate path="/scopri">
            <Candidates />
          </AuthGate>
        </Suspense>
      </section>
    </main>
  )
}
