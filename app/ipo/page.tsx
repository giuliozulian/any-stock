import { Suspense } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { getIpoCalendar, type IpoEvent } from '@/lib/finnhub'
import styles from '../section.module.css'

const dayFormat: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }

function formatDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(`${d}T00:00:00Z`) : d
  return date.toLocaleDateString('it-IT', dayFormat)
}

function formatMoney(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} mld $`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} mln $`
  return `${n.toFixed(0)} $`
}


async function IpoList() {
  await connection()
  const now = new Date()
  const from = now.toISOString().slice(0, 10)
  const to = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  let ipos: IpoEvent[] | null = null
  try {
    ipos = await getIpoCalendar(from, to)
  } catch (err) {
    console.error('IPO calendar failed:', err instanceof Error ? err.message : err)
    ipos = null
  }
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Nuove quotazioni (IPO)</h2>
      <p className={styles.lead}>Società che debuttano in Borsa nei prossimi 45 giorni, in ordine di data.</p>
      {ipos === null ? (
        <p className={styles.empty}>Non riesco a scaricare il calendario IPO in questo momento. Riprova tra qualche minuto.</p>
      ) : ipos.length === 0 ? (
        <p className={styles.empty}>Nessuna IPO in calendario nei prossimi 45 giorni.</p>
      ) : (
        <ul className={styles.list}>
          {ipos.map((i, idx) => (
            <li key={`${i.date}-${i.name}-${idx}`} className={styles.item}>
              <span className={styles.date}>{formatDay(i.date)}</span>
              <span className={styles.main}>
                {i.symbol ? <Link href={`/stock/${encodeURIComponent(i.symbol)}`}>{i.name}</Link> : i.name}
                <span className={styles.sub}>{[i.symbol, i.exchange].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={styles.side}>
                {i.price ? `${i.price} $` : ''}
                {i.totalValue ? `${i.price ? ' · ' : ''}${formatMoney(i.totalValue)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function IpoPage() {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Nuove quotazioni (IPO)</h1>
      <Suspense fallback={<p className={styles.empty}>Carico le IPO…</p>}>
        <IpoList />
      </Suspense>
    </main>
  )
}
