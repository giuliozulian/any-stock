import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import styles from '../section.module.css'

const dayFormat: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }

function formatDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(`${d}T00:00:00Z`) : d
  return date.toLocaleDateString('it-IT', dayFormat)
}


async function EarningsCalendar() {
  await connection()
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const stocks = await prisma.stock.findMany({
    where: { nextEarningsDate: { gte: start } },
    orderBy: { nextEarningsDate: 'asc' },
  })
  const hourLabel: Record<string, string> = { bmo: 'prima dell’apertura', amc: 'dopo la chiusura', dmh: 'durante la seduta' }
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Calendario trimestrali</h2>
      <p className={styles.lead}>Le prossime trimestrali dei titoli che segui, dalla più vicina. Le date si aggiornano a ogni refresh.</p>
      {stocks.length === 0 ? (
        <p className={styles.empty}>Nessuna trimestrale in programma: premi Refresh sui titoli per scaricare le date.</p>
      ) : (
        <ul className={styles.list}>
          {stocks.map((s) => (
            <li key={s.id} className={styles.item}>
              <span className={styles.date}>{formatDay(s.nextEarningsDate!)}</span>
              <span className={styles.main}>
                <Link href={`/stock/${s.symbol}`}>{s.symbol}</Link>
                <span className={styles.sub}>{s.name}</span>
              </span>
              <span className={styles.side}>
                {s.nextEarningsHour && hourLabel[s.nextEarningsHour] ? `${hourLabel[s.nextEarningsHour]}` : ''}
                {s.nextEarningsEpsEstimate !== null ? `${s.nextEarningsHour ? ' · ' : ''}EPS atteso ${s.nextEarningsEpsEstimate.toFixed(2)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function EarningsPage() {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Calendario trimestrali</h1>
      <Suspense fallback={<p className={styles.empty}>Carico le trimestrali…</p>}>
        <EarningsCalendar />
      </Suspense>
    </main>
  )
}
