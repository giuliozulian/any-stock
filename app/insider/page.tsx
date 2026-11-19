import { Suspense } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { SectionSkeleton } from '@/components/SectionSkeleton'
import { AuthGate } from '@/components/AuthGate'
import { ClusterCard } from '@/components/ClusterCard'
import { InfoTip } from '@/components/InfoTip'
import { capBucket, getMarketClusters } from '@/lib/insider-clusters'
import table from '../movimenti/movimenti.module.css'
import styles from '../section.module.css'

export const maxDuration = 60

// The model writes the note for the first cards only: enough to read, and it keeps the first load and the cost bounded.
const NOTES_FOR = 15

type Search = { cap?: string; ordina?: string }

const CAPS = [
  { key: 'lm', label: 'Large + Mid', buckets: ['large', 'mid'] },
  { key: 'large', label: 'Large', buckets: ['large'] },
  { key: 'mid', label: 'Mid', buckets: ['mid'] },
  { key: 'tutte', label: 'Tutte', buckets: ['large', 'mid', 'small'] },
] as const
const SORTS = [
  { key: 'best', label: 'Migliori' },
  { key: 'recenti', label: 'Più recenti' },
] as const

async function Clusters({ searchParams }: { searchParams: Promise<Search> }) {
  await connection()
  const params = await searchParams
  const cap = CAPS.find((c) => c.key === params.cap) ?? CAPS[0]
  const sort = SORTS.find((s) => s.key === params.ordina) ?? SORTS[0]
  const href = (over: Partial<{ cap: string; ordina: string }>) => `/insider?${new URLSearchParams({ cap: cap.key, ordina: sort.key, ...over }).toString()}`

  const all = await getMarketClusters()
  const shown = all
    .filter((c) => (cap.buckets as readonly string[]).includes(capBucket(c.marketCap)))
    .sort((a, b) => (sort.key === 'recenti' ? b.cluster.to.localeCompare(a.cluster.to) || b.cluster.score - a.cluster.score : b.cluster.score - a.cluster.score))

  return (
    <>
      <div className={table.filters}>
        <nav className={table.group} aria-label="Capitalizzazione">
          {CAPS.map((c) => (
            <Link key={c.key} href={href({ cap: c.key })} aria-current={c.key === cap.key ? 'page' : undefined}>
              {c.label}
            </Link>
          ))}
        </nav>
        <nav className={table.group} aria-label="Ordina per">
          {SORTS.map((s) => (
            <Link key={s.key} href={href({ ordina: s.key })} aria-current={s.key === sort.key ? 'page' : undefined}>
              {s.label}
            </Link>
          ))}
        </nav>
      </div>
      {shown.length === 0 ? (
        <p className={styles.empty}>{all.length === 0 ? 'Nessun cluster trovato o dati SEC non raggiungibili al momento. Riprova tra qualche minuto.' : 'Nessun cluster per la capitalizzazione scelta.'}</p>
      ) : (
        shown.map((c, i) => <ClusterCard key={c.symbol} item={c} withNote={i < NOTES_FOR} />)
      )}
    </>
  )
}

export default function InsiderPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Cluster insider</h1>
      <section className={styles.section}>
        <p className={styles.lead}>
          Titoli USA dove almeno due dirigenti o consiglieri hanno comprato azioni sul mercato negli ultimi giorni. Più persone, più soldi e ruoli più alti pesano di più.
          <InfoTip
            label="Come funziona il punteggio"
            source="SEC EDGAR (indici giornalieri dei Form 4), Finnhub, Yahoo Finance"
            formula="acquisti sul mercato (P) dei 7 giorni che finiscono con l’ultimo; punteggio nostro 0-100: fino a 40 per il denaro, 25 per il numero di insider, 20 per il ruolo (CEO/CFO/presidente), 15 per quanto è recente. Large cap da 10 miliardi, mid cap da 2 miliardi"
          >
            <strong>Un acquisto con soldi propri è il segnale più forte</strong>
            <span>Quando più persone comprano insieme il segnale pesa di più. Non è una previsione né un consiglio d&apos;acquisto.</span>
            <span>La lista si aggiorna ogni ora; la prima apertura può richiedere fino a un minuto.</span>
          </InfoTip>
        </p>
        <Suspense fallback={<SectionSkeleton label="Cerco i cluster sulla SEC…" variant="cards" />}>
          <AuthGate path="/insider">
            <Clusters searchParams={searchParams} />
          </AuthGate>
        </Suspense>
      </section>
    </main>
  )
}
