import { Suspense } from 'react'
import { connection } from 'next/server'
import { prisma } from '@/lib/db'
import { FinvizScreen } from '@/components/FinvizScreen'
import { ScannerButton } from '@/components/ScannerButton'
import { ScannerInfo } from '@/components/ScannerInfo'
import { ScannerTable } from '@/components/ScannerTable'
import type { Criterion } from '@/lib/minervini'
import { emailConfigured } from '@/lib/notify'
import { getAlertState } from '@/lib/scan-alerts-db'
import { currentUserId } from '@/lib/watchlist'
import { duringSession, toScanRow } from '@/lib/scan-verdict'
import { marketHealth } from '@/lib/scanner'
import { PARTIAL_UNREAD_SHARE, latestCompleteRun, runTiming, runningRun } from '@/lib/scanner-run'
import styles from '../section.module.css'
import local from './page.module.css'
import { ScannerSkeleton } from './ScannerSkeleton'
import { AuthGate } from '@/components/AuthGate'

const ROME = 'Europe/Rome'
const day = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ROME })
const time = (d: Date) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: ROME })

const ageText = (days: number) => (days === 1 ? 'di ieri' : `di ${days} giorni fa`)

async function ScannerContent() {
  await connection()
  const [run, running, alertState] = await Promise.all([latestCompleteRun(), runningRun(), currentUserId().then(getAlertState)])
  const { lockedUntil, ageDays } = runTiming(run?.finishedAt ?? null, new Date())
  const lockedLabel = lockedUntil && !running ? `Disponibile dalle ${time(lockedUntil)}` : null

  const readable = run ? await prisma.scanResult.findMany({ where: { runId: run.id, status: 'ok' } }) : []
  const rows = readable.filter((r) => (r.passedCount ?? 0) >= 7).map(toScanRow)
  const market = marketHealth(readable.map((r) => (Array.isArray(r.criteria) ? r.criteria : []) as unknown as Criterion[]))
  const session = run !== null && duringSession(run.startedAt, run.finishedAt)
  const caution = session ? 'session' : ageDays >= 1 ? 'stale' : null

  const status =
    run?.finishedAt &&
    `Ultima scansione ${day(run.finishedAt)} alle ${time(run.finishedAt)}: letti ${run.total - run.unreadCount} titoli su ${run.total}.`
  // One line for everything that makes the numbers less reliable, instead of one banner each.
  const notices = run
    ? [
        session && 'Scansione fatta a mercato aperto: il volume di oggi è parziale, quindi nessun titolo è segnalato come da comprare. Rilancia dopo le 22:30 ora italiana.',
        ageDays >= 1 && `Risultati ${ageText(ageDays)}: i prezzi non sono aggiornati.`,
        run.unreadCount > run.total * PARTIAL_UNREAD_SHARE && 'Dati parziali: troppi titoli non letti, la forza relativa è meno affidabile.',
      ].filter(Boolean)
    : []

  return (
    <>
      <div className={local.bar}>
        <p className={local.status}>{status || 'Nessuna scansione ancora eseguita.'}</p>
        <div className={local.actions}>
          <ScannerButton resumable={running !== null} lockedLabel={lockedLabel} />
          <FinvizScreen />
        </div>
      </div>
      {notices.length > 0 && (
        <p role="note" className={local.stale}>
          {notices.join(' ')}
        </p>
      )}
      <ScannerInfo defaultOpen={!run} />
      {run?.finishedAt && <ScannerTable rows={rows} caution={caution} market={market} alerts={{ emailReady: emailConfigured(), ...alertState }} />}
    </>
  )
}

export default function ScannerPage() {
  return (
    <main className={styles.shell}>
      <h1 className={local.heading}>Minervini SCAN</h1>
      <Suspense fallback={<ScannerSkeleton />}>
        <AuthGate path="/scanner">
          <ScannerContent />
        </AuthGate>
      </Suspense>
    </main>
  )
}
