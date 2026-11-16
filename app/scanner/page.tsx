import { Suspense } from 'react'
import { connection } from 'next/server'
import { prisma } from '@/lib/db'
import { ScannerButton } from '@/components/ScannerButton'
import { ScannerInfo } from '@/components/ScannerInfo'
import { ScannerTable, type ScannerRow } from '@/components/ScannerTable'
import type { Criterion, VcpStatus } from '@/lib/minervini'
import { missingCriterion } from '@/lib/scanner'
import { PARTIAL_UNREAD_SHARE, latestCompleteRun, runningRun } from '@/lib/scanner-run'
import styles from '../section.module.css'
import local from './page.module.css'

async function Results() {
  await connection()
  const run = await latestCompleteRun()
  if (!run) return <p className={styles.empty}>Nessuna scansione ancora eseguita. Premi “Avvia scansione” per iniziare.</p>

  const found = await prisma.scanResult.findMany({ where: { runId: run.id, status: 'ok', passedCount: { gte: 7 } } })
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
    missing: r.passedCount === 7 ? missingCriterion((r.criteria ?? []) as unknown as Criterion[], r.rs) : null,
  }))
  const readable = run.total - run.unreadCount
  const partial = run.unreadCount > run.total * PARTIAL_UNREAD_SHARE

  return (
    <>
      <p className={local.scannedAt}>
        Ultima scansione: {run.finishedAt?.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })} alle{' '}
        {run.finishedAt?.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} · {readable} titoli letti, {run.unreadCount} non letti
      </p>
      {partial && (
        <p role="note" className={local.partial}>
          Dati parziali: troppi titoli non sono stati letti, quindi la forza relativa è meno affidabile.
        </p>
      )}
      <ScannerTable rows={rows} />
    </>
  )
}

async function Controls() {
  await connection()
  return <ScannerButton resumable={(await runningRun()) !== null} />
}

export default function ScannerPage() {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Scanner Minervini</h1>
      <section className={styles.section}>
        <p className={styles.lead}>Cerca tra i titoli dell’S&amp;P 500 quelli che soddisfano il Trend Template di Minervini e mostra stato VCP e distanza dal pivot.</p>
        <Suspense fallback={null}>
          <Controls />
        </Suspense>
        <ScannerInfo />
        <Suspense fallback={<p className={styles.empty}>Carico i risultati…</p>}>
          <Results />
        </Suspense>
      </section>
    </main>
  )
}
