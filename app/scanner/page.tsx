import { Suspense } from 'react'
import { connection } from 'next/server'
import { prisma } from '@/lib/db'
import { ScannerButton } from '@/components/ScannerButton'
import { ScannerInfo } from '@/components/ScannerInfo'
import { ScannerTable, type ScannerRow } from '@/components/ScannerTable'
import type { Criterion, VcpStatus } from '@/lib/minervini'
import { missingCriterion } from '@/lib/scanner'
import { PARTIAL_UNREAD_SHARE, latestCompleteRun, runTiming, runningRun } from '@/lib/scanner-run'
import styles from '../section.module.css'
import local from './page.module.css'

const ROME = 'Europe/Rome'
const day = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ROME })
const time = (d: Date) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: ROME })

const ageText = (days: number) => (days === 1 ? 'di ieri' : `di ${days} giorni fa`)

async function ScannerContent() {
  await connection()
  const [run, running] = await Promise.all([latestCompleteRun(), runningRun()])
  const { lockedUntil, ageDays } = runTiming(run?.finishedAt ?? null, new Date())
  const lockedLabel = lockedUntil && !running ? `Disponibile dalle ${time(lockedUntil)}` : null

  const found = run ? await prisma.scanResult.findMany({ where: { runId: run.id, status: 'ok', passedCount: { gte: 7 } } }) : []
  const rows: ScannerRow[] = found.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    price: r.price!,
    rs: r.rs,
    passedCount: r.passedCount!,
    vcpStatus: r.vcpStatus as VcpStatus | null,
    pivot: r.pivot,
    pivotDistancePct: r.pivotDistancePct,
    volumeRatio: r.volumeRatio,
    missing: r.passedCount === 7 ? missingCriterion((r.criteria ?? []) as unknown as Criterion[], r.rs) : null,
  }))

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
          <ScannerTable rows={rows} />
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
      <Suspense fallback={<p className={styles.empty}>Carico lo scanner…</p>}>
        <ScannerContent />
      </Suspense>
    </main>
  )
}
