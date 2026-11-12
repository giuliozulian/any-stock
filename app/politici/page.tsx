import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { getRecentCongressBuys, clusterBuys, type CongressBuy } from '@/lib/congress'
import { InfoTip } from '@/components/InfoTip'
import styles from '../section.module.css'

const short = (v: number) => (v >= 1_000_000 ? `${+(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}k` : String(v))
const day = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—')
const amount = (low: number, high: number) => (high > 0 ? `$${short(low)} – $${short(high)}` : '—')
const BIG_BUY_MIN = 50_000
const FRESH_DAYS = 7

function Perf({ pct }: { pct: number | null }) {
  if (pct === null) return null
  return (
    <span className={pct >= 0 ? styles.gain : styles.loss}>
      {pct >= 0 ? '+' : '−'}
      {Math.abs(pct).toFixed(1)}% da quando hanno comprato
    </span>
  )
}

function who(b: CongressBuy): string {
  const chamber = b.chamber === 'senate' ? 'Senato' : b.chamber === 'house' ? 'Camera' : b.chamber
  return `${b.member} (${chamber}${b.state ? ` ${b.state}` : ''})`
}

async function CongressBuys() {
  await connection()
  const buys = await getRecentCongressBuys()
  const symbolLink = (t: string) => <Link href={`/stock/${encodeURIComponent(t)}`}>{t}</Link>

  if (buys === null) return <p className={styles.empty}>Non riesco a scaricare le operazioni dei politici in questo momento. Riprova tra qualche minuto.</p>
  if (buys.length === 0) return <p className={styles.empty}>Nessun acquisto dichiarato di recente.</p>

  const clusters = clusterBuys(buys).slice(0, 12)
  const big = buys
    .filter((b) => b.amountLow >= BIG_BUY_MIN)
    .sort((a, b) => b.amountHigh - a.amountHigh || b.disclosedAt.localeCompare(a.disclosedAt))
    .slice(0, 10)
  const newest = new Date(`${buys[0].disclosedAt}T00:00:00Z`)
  const cutoff = new Date(newest.getTime() - FRESH_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const fresh = buys.filter((b) => b.disclosedAt >= cutoff).slice(0, 30)

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.heading}>
          Comprati da più politici
          <InfoTip
            label="Perché conta se più politici comprano lo stesso titolo"
            source="Bargo (API gratuita), che raccoglie le dichiarazioni obbligatorie (STOCK Act) di deputati e senatori USA alla House Clerk e al Senate eFD"
            formula="titoli acquistati da almeno 2 politici diversi nelle dichiarazioni recenti; il guadagno è la media di quanto il prezzo è cambiato dalla data di acquisto di ciascuno"
          >
            <strong>Acquisti in comune</strong>
            <span>Quando più politici, spesso di partiti diversi, comprano lo stesso titolo in poche settimane, vale la pena guardarlo meglio.</span>
            <span>Il dato è in ritardo (fino a 45 giorni) e gli importi sono fasce: è uno spunto da verificare, non un consiglio di investimento.</span>
          </InfoTip>
        </h2>
        <p className={styles.lead}>Il punto di partenza per cercare nuove idee: titoli che più di un politico ha scelto di comprare.</p>
        {clusters.length === 0 ? (
          <p className={styles.empty}>Al momento nessun titolo è stato comprato da più di un politico.</p>
        ) : (
          <ul className={styles.list}>
            {clusters.map((c) => (
              <li key={c.ticker} className={styles.item}>
                <span className={styles.main}>
                  {symbolLink(c.ticker)}
                  <span className={styles.sub}>{c.asset}</span>
                </span>
                <span className={styles.date}>
                  {c.members.length} politici: {c.members.join(', ')}
                </span>
                <span className={styles.side}>
                  {amount(c.totalLow, c.totalHigh)} in totale · pubblicato il {day(c.lastDisclosedAt)}
                  <br />
                  <Perf pct={c.avgPerfPct} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Gli acquisti più grossi</h2>
        <p className={styles.lead}>Singole operazioni da almeno ${short(BIG_BUY_MIN)}: chi investe molto di solito ha una convinzione forte.</p>
        {big.length === 0 ? (
          <p className={styles.empty}>Nessun acquisto sopra ${short(BIG_BUY_MIN)} tra quelli recenti.</p>
        ) : (
          <ul className={styles.list}>
            {big.map((b, i) => (
              <li key={`${b.member}-${b.ticker}-${b.date}-${i}`} className={styles.item}>
                <span className={styles.main}>
                  {symbolLink(b.ticker)}
                  <span className={styles.sub}>{b.asset}</span>
                </span>
                <span className={styles.date}>
                  {who(b)} · {amount(b.amountLow, b.amountHigh)}
                </span>
                <span className={styles.side}>
                  comprato il {day(b.date)}
                  <br />
                  <Perf pct={b.perfPct} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Appena pubblicati</h2>
        <p className={styles.lead}>Acquisti dichiarati negli ultimi {FRESH_DAYS} giorni di pubblicazioni.</p>
        {fresh.length === 0 ? (
          <p className={styles.empty}>Nessuna nuova dichiarazione.</p>
        ) : (
          <ul className={styles.list}>
            {fresh.map((b, i) => (
              <li key={`${b.member}-${b.ticker}-${b.date}-${i}`} className={styles.item}>
                <span className={styles.date}>pubblicato il {day(b.disclosedAt)}</span>
                <span className={styles.main}>
                  {symbolLink(b.ticker)}
                  <span className={styles.sub}>
                    {b.asset} · {who(b)}
                  </span>
                </span>
                <span className={styles.side}>{amount(b.amountLow, b.amountHigh)}</span>
              </li>
            ))}
          </ul>
        )}
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
