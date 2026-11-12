import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { getRecentCongressBuys, topBought } from '@/lib/congress'
import { InfoTip } from '@/components/InfoTip'
import styles from '../section.module.css'

const short = (v: number) => (v >= 1_000_000 ? `${v / 1_000_000}M` : v >= 1_000 ? `${Math.round(v / 1_000)}k` : String(v))
const day = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—')

async function CongressBuys() {
  await connection()
  const [buys, watched] = await Promise.all([getRecentCongressBuys(), prisma.stock.findMany({ select: { symbol: true } })])
  const watchedSymbols = new Set(watched.map((s) => s.symbol))
  const symbolLink = (t: string) => (watchedSymbols.has(t) ? <Link href={`/stock/${t}`}>{t}</Link> : t)

  if (buys === null) return <p className={styles.empty}>Non riesco a scaricare le operazioni dei politici in questo momento. Riprova tra qualche minuto.</p>
  if (buys.length === 0) return <p className={styles.empty}>Nessun acquisto dichiarato di recente.</p>

  const top = topBought(buys)
  const latest = buys.slice(0, 60)
  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.heading}>Più comprati negli ultimi mesi</h2>
        <p className={styles.lead}>Titoli acquistati da più politici diversi tra quelli dichiarati di recente.</p>
        <ul className={styles.list}>
          {top.map((t) => (
            <li key={t.ticker} className={styles.item}>
              <span className={styles.main}>{symbolLink(t.ticker)}</span>
              <span className={styles.main}>
                <span className={styles.sub}>{t.asset}</span>
              </span>
              <span className={styles.side}>
                {t.members} {t.members === 1 ? 'politico' : 'politici'} · {t.trades} {t.trades === 1 ? 'acquisto' : 'acquisti'}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>
          Ultimi acquisti dichiarati
          <InfoTip
            label="Come leggere le operazioni dei politici"
            source="Bargo (API gratuita), che raccoglie le dichiarazioni obbligatorie (STOCK Act) di deputati e senatori USA alla House Clerk e al Senate eFD"
            formula="solo acquisti, dal più recente per data di pubblicazione; le righe identiche sono contate una volta. Gli importi sono fasce, non cifre esatte"
          >
            <strong>Operazioni dei membri del Congresso</strong>
            <span>Deputati e senatori devono dichiarare le loro operazioni in titoli entro 45 giorni. L’importo è una fascia (ad esempio $1k – $15k).</span>
            <span>Il dato è in ritardo e non dice perché hanno comprato: è uno spunto, non una previsione.</span>
          </InfoTip>
        </h2>
        <p className={styles.lead}>I 60 acquisti più recenti pubblicati. La data è quella della pubblicazione; tra parentesi quella dell’operazione.</p>
        <ul className={styles.list}>
          {latest.map((b, i) => (
            <li key={`${b.member}-${b.ticker}-${b.date}-${i}`} className={styles.item}>
              <span className={styles.date}>
                {day(b.disclosedAt)} ({day(b.date)})
              </span>
              <span className={styles.main}>
                {b.member}
                <span className={styles.sub}>
                  {b.chamber === 'senate' ? 'Senato' : b.chamber === 'house' ? 'Camera' : b.chamber}
                  {b.state ? ` ${b.state}` : ''}
                </span>
              </span>
              <span className={styles.side}>
                {symbolLink(b.ticker)} · {b.asset} · {b.amountHigh > 0 ? `$${short(b.amountLow)} – $${short(b.amountHigh)}` : '—'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

export default function PoliticiPage() {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Cosa comprano i politici americani</h1>
      <Suspense fallback={<p className={styles.empty}>Carico le operazioni…</p>}>
        <CongressBuys />
      </Suspense>
    </main>
  )
}
