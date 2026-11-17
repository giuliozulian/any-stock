import { Suspense } from 'react'
import { connection } from 'next/server'
import { prisma } from '@/lib/db'
import { ScannerButton } from '@/components/ScannerButton'
import { ScannerInfo } from '@/components/ScannerInfo'
import { ScannerTable } from '@/components/ScannerTable'
import type { Criterion } from '@/lib/minervini'
import { emailConfigured } from '@/lib/notify'
import { getAlertState } from '@/lib/scan-alerts-db'
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
  const [run, running, alertState] = await Promise.all([latestCompleteRun(), runningRun(), getAlertState()])
  const { lockedUntil, ageDays } = runTiming(run?.finishedAt ?? null, new Date())
  const lockedLabel = lockedUntil && !running ? `Disponibile dalle ${time(lockedUntil)}` : null

  const readable = run ? await prisma.scanResult.findMany({ where: { runId: run.id, status: 'ok' } }) : []
  const rows = readable.filter((r) => (r.passedCount ?? 0) >= 7).map(toScanRow)
  const market = marketHealth(readable.map((r) => (Array.isArray(r.criteria) ? r.criteria : []) as unknown as Criterion[]))
  const session = run !== null && duringSession(run.startedAt, run.finishedAt)
  const caution = session ? 'session' : ageDays >= 1 ? 'stale' : null

  return (
    <>
      <ScannerInfo defaultOpen={!run} />
      <ScannerButton resumable={running !== null} lockedLabel={lockedLabel} />
      {!run || !run.finishedAt ? (
        <p className={styles.empty}>Nessuna scansione ancora eseguita. Premi “Avvia scansione” per iniziare.</p>
      ) : (
        <>
          <p className={local.meta}>
            Ultima scansione il {day(run.finishedAt)} alle {time(run.finishedAt)}. Letti {run.total - run.unreadCount} titoli su {run.total}.
          </p>
          {session && (
            <p role="note" className={local.stale}>
              Scansione fatta a mercato aperto: il volume di oggi è parziale, quindi nessun titolo è segnalato come da comprare. Rilancia dopo le 22:30 ora italiana.
            </p>
          )}
          {ageDays >= 1 && (
            <p role="note" className={local.stale}>
              Risultati {ageText(ageDays)}: i prezzi non sono aggiornati. Rilancia la scansione.
            </p>
          )}
          {run.unreadCount > run.total * PARTIAL_UNREAD_SHARE && (
            <p role="note" className={local.stale}>
              Dati parziali: troppi titoli non sono stati letti, quindi la forza relativa è meno affidabile.
            </p>
          )}
          <ScannerTable rows={rows} caution={caution} market={market} alerts={{ emailReady: emailConfigured(), ...alertState }} />
        </>
      )}
    </>
  )
}

export default function ScannerPage() {
  return (
    <main className={styles.shell}>
      <h1 className={local.heading}>Scanner Minervini</h1>
      <p className={local.lead}>Titoli dell’S&amp;P 500 che passano il Trend Template di Minervini, con lo stato della base e la distanza dal pivot.</p>
      <Suspense fallback={<ScannerSkeleton />}>
        <AuthGate path="/scanner">
          <ScannerContent />
        </AuthGate>
      </Suspense>
    </main>
  )
}
