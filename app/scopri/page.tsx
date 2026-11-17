import { Suspense } from 'react'
import Link from 'next/link'
import { SectionSkeleton } from '@/components/SectionSkeleton'
import { connection } from 'next/server'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/watchlist'
import { ScanButton } from '@/components/ScanButton'
import { CandidateCard } from '@/components/CandidateCard'
import { InfoTip } from '@/components/InfoTip'
import { hoursSince } from '@/lib/discover'
import { getPastPicks, summarizePicks, HIGH_SCORE, type PastPick } from '@/lib/discover-history'
import { latestCompleteRun } from '@/lib/scanner-run'
import table from '../movimenti/movimenti.module.css'
import styles from '../section.module.css'
import local from './page.module.css'
import { AuthGate } from '@/components/AuthGate'

type Search = { sezione?: string; min?: string; nuovi?: string; ordina?: string }

const TABS = [
  { key: 'tutti', label: 'Tutti' },
  { key: 'persone', label: 'Persone' },
  { key: 'eventi', label: 'Eventi' },
  { key: 'simili', label: 'Simili ai tuoi' },
  { key: 'italia', label: 'Italia' },
  { key: 'andata', label: 'Com’è andata' },
] as const
type Tab = (typeof TABS)[number]['key']

const MIN_SCORES = [0, 40, HIGH_SCORE]
const SORTS = [
  { key: 'punteggio', label: 'Punteggio' },
  { key: 'cap', label: 'Capitalizzazione' },
  { key: 'variazione', label: 'Variazione di oggi' },
] as const
type Sort = (typeof SORTS)[number]['key']

// Where each tab looks: the door a stock came in from (a stock can come from several).
const TAB_SOURCES: Record<Exclude<Tab, 'tutti' | 'andata'>, string[]> = {
  persone: ['congress', 'edgar-form4-cluster'],
  eventi: ['earnings-beat', 'ipo'],
  simili: ['peer'],
  italia: ['movers-it'],
}
const STALE_HOURS = 48
const NEW_WITHIN_MS = 60_000

const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`
const percent = (n: number) => `${Math.round(n * 100)}%`
const day = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'Europe/Rome' })

function ageText(hours: number): string {
  if (hours < 1) return 'meno di un’ora fa'
  if (hours < 24) return `${hours} ${hours === 1 ? 'ora' : 'ore'} fa`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'giorno' : 'giorni'} fa`
}

function PastPicks({ picks }: { picks: PastPick[] }) {
  const s = summarizePicks(picks)
  if (picks.length === 0) {
    return <p className={styles.empty}>Ancora nessun titolo proposto da almeno una settimana. Dopo qualche scansione qui vedrai come sono andati rispetto all’S&amp;P 500.</p>
  }
  return (
    <>
      <p className={local.verdict}>
        Dei <strong>{s.count}</strong> titoli proposti negli ultimi 90 giorni, <strong>{s.beat}</strong> hanno battuto l’S&amp;P 500
        {s.hitRate !== null && <> ({percent(s.hitRate)})</>}
        {s.avgExcessPct !== null && <>, con {signed(s.avgExcessPct)} punti in media rispetto al mercato</>}.
        {s.high.count > 0 && s.high.hitRate !== null && (
          <>
            {' '}
            Tra quelli con punteggio almeno {HIGH_SCORE} ({s.high.count}): {percent(s.high.hitRate)}.
          </>
        )}
      </p>
      <p className={local.caveat}>
        Si parte dal prezzo della prima scansione in cui il titolo è comparso. Sono pochi casi e pochi mesi: serve a capire se il punteggio vale qualcosa, non è una promessa di rendimento.
      </p>
      <div className={table.wrap}>
        <table className={table.table}>
          <thead>
            <tr>
              <th scope="col">Titolo</th>
              <th scope="col" className={table.num}>Comparso il</th>
              <th scope="col" className={table.num}>Punteggio</th>
              <th scope="col" className={table.num}>Da allora</th>
              <th scope="col" className={table.num}>S&amp;P 500</th>
              <th scope="col" className={table.num}>Rispetto al mercato</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => (
              <tr key={p.symbol}>
                <td>
                  <Link href={`/stock/${encodeURIComponent(p.symbol)}`} className={table.symbol}>
                    {p.symbol}
                  </Link>
                  <span className={table.name}>{p.name}</span>
                </td>
                <td className={table.num}>{day(p.firstSeen)}</td>
                <td className={table.num}>{Math.round(p.firstScore)}</td>
                <td className={`${table.num} ${p.returnPct >= 0 ? styles.gain : styles.loss}`}>{signed(p.returnPct)}%</td>
                <td className={table.num}>{p.marketPct === null ? '–' : `${signed(p.marketPct)}%`}</td>
                <td className={`${table.num} ${p.excessPct === null ? '' : p.excessPct >= 0 ? styles.gain : styles.loss}`}>{p.excessPct === null ? '–' : `${signed(p.excessPct)} punti`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

async function Candidates({ searchParams }: { searchParams: Promise<Search> }) {
  await connection()
  const params = await searchParams
  const tab: Tab = TABS.find((t) => t.key === params.sezione)?.key ?? 'tutti'
  const min = MIN_SCORES.includes(Number(params.min)) ? Number(params.min) : 0
  const onlyNew = params.nuovi === '1'
  const sort: Sort = SORTS.find((s) => s.key === params.ordina)?.key ?? 'punteggio'

  const href = (over: Partial<{ sezione: string; min: number; nuovi: string; ordina: string }>) => {
    const q = new URLSearchParams({ sezione: tab, min: String(min), ordina: sort })
    if (onlyNew) q.set('nuovi', '1')
    for (const [k, v] of Object.entries(over)) {
      if (v === '') q.delete(k)
      else q.set(k, String(v))
    }
    return `/scopri?${q.toString()}`
  }

  const latest = await prisma.discoveredCandidate.aggregate({ _max: { scannedAt: true } })
  const scannedAt = latest._max.scannedAt
  if (!scannedAt) {
    return <p className={styles.empty}>Nessuna ricerca ancora eseguita. Premi «Scansiona ora» per iniziare.</p>
  }

  const userId = await currentUserId()
  const now = new Date()
  const [rows, hiddenRows, watched, run, picks] = await Promise.all([
    prisma.discoveredCandidate.findMany({ where: { scannedAt } }),
    prisma.discoveryDismissal.findMany({ where: { userId, OR: [{ until: null }, { until: { gt: now } }] }, select: { symbol: true } }),
    prisma.stock.findMany({ where: { watchers: { some: { userId } } }, select: { symbol: true } }),
    tab === 'andata' ? null : latestCompleteRun(),
    tab === 'andata' ? getPastPicks() : Promise.resolve([] as PastPick[]),
  ])
  const hidden = new Set(hiddenRows.map((h) => h.symbol))
  const mine = new Set(watched.map((w) => w.symbol.toUpperCase()))
  // What the Minervini scan made of these stocks, so one page can say if the technical side agrees.
  const scanned = run ? await prisma.scanResult.findMany({ where: { runId: run.id, status: 'ok', symbol: { in: rows.map((r) => r.symbol) } }, select: { symbol: true, passedCount: true } }) : []
  const passed = new Map(scanned.map((s) => [s.symbol, s.passedCount]))

  const visible = rows.filter((r) => !hidden.has(r.symbol) && !mine.has(r.symbol.toUpperCase()))
  const inTab = visible.filter((r) => tab === 'tutti' || tab === 'andata' || r.source.split(',').some((s) => TAB_SOURCES[tab].includes(s)))
  const counts = (key: Tab) => (key === 'tutti' ? visible.length : key === 'andata' ? null : visible.filter((r) => r.source.split(',').some((s) => TAB_SOURCES[key].includes(s))).length)
  const shown = inTab
    .filter((r) => r.score >= min)
    .filter((r) => !onlyNew || Math.abs(r.firstSeenAt.getTime() - scannedAt.getTime()) < NEW_WITHIN_MS)
    .sort((a, b) =>
      sort === 'cap' ? (b.marketCap ?? -1) - (a.marketCap ?? -1) : sort === 'variazione' ? Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0) : b.score - a.score
    )

  const hours = hoursSince(scannedAt)

  return (
    <>
      <p className={local.scannedAt}>
        Ultimo scan: {ageText(hours)} ({scannedAt.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'Europe/Rome' })} alle {scannedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })}).
        {hours >= STALE_HOURS && <span className={local.stale}> I dati sono vecchi: premi «Scansiona ora».</span>}
      </p>

      <nav className={local.tabs} aria-label="Sezioni">
        {TABS.map((t) => {
          const n = counts(t.key)
          return (
            <Link key={t.key} href={href({ sezione: t.key })} aria-current={t.key === tab ? 'page' : undefined}>
              {t.label}
              {n !== null && <span className={local.tabCount}>{n}</span>}
            </Link>
          )
        })}
      </nav>

      {tab === 'andata' ? (
        <PastPicks picks={picks} />
      ) : (
        <>
          <div className={table.filters}>
            <nav className={table.group} aria-label="Punteggio minimo">
              {MIN_SCORES.map((m) => (
                <Link key={m} href={href({ min: m })} aria-current={m === min ? 'page' : undefined}>
                  {m === 0 ? 'Tutti i punteggi' : `Almeno ${m}`}
                </Link>
              ))}
            </nav>
            <nav className={table.group} aria-label="Ordina per">
              {SORTS.map((s) => (
                <Link key={s.key} href={href({ ordina: s.key })} aria-current={s.key === sort ? 'page' : undefined}>
                  {s.label}
                </Link>
              ))}
            </nav>
            <nav className={table.group} aria-label="Novità">
              <Link href={href({ nuovi: onlyNew ? '' : '1' })} aria-current={onlyNew ? 'page' : undefined}>
                Solo nuovi
              </Link>
            </nav>
          </div>
          {shown.length === 0 ? (
            <p className={styles.empty}>{visible.length === 0 ? 'Nessun candidato: li hai già aggiunti o nascosti tutti, oppure lo scan non ne ha trovati.' : 'Nessun candidato corrisponde ai filtri scelti. Togline qualcuno.'}</p>
          ) : (
            shown.map((c) => (
              <CandidateCard
                key={c.symbol}
                candidate={{
                  symbol: c.symbol, name: c.name, market: c.market as 'US' | 'IT', score: c.score,
                  momentumScore: c.momentumScore, fundamentalsScore: c.fundamentalsScore, insiderScore: c.insiderScore,
                  reason: c.reason, aiVerdict: c.aiVerdict === 'solid' || c.aiVerdict === 'caution' ? c.aiVerdict : null, aiNote: c.aiNote,
                  partial: c.partial, source: c.source, price: c.price, changePct: c.changePct, marketCap: c.marketCap, flags: c.flags,
                  spark: Array.isArray(c.spark) ? (c.spark as number[]) : null,
                  isNew: Math.abs(c.firstSeenAt.getTime() - scannedAt.getTime()) < NEW_WITHIN_MS,
                  scoreDelta: c.prevScore === null ? null : c.score - c.prevScore,
                  scannerPassed: passed.get(c.symbol) ?? null,
                }}
              />
            ))
          )}
        </>
      )}
    </>
  )
}

export default function DiscoverPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Scopri titoli</h1>
      <section className={styles.section}>
        <p className={styles.lead}>
          Idee di titoli che non segui ancora, da USA e Italia: acquisti di politici e dirigenti, utili sopra le attese, IPO recenti, concorrenti dei tuoi titoli. Il punteggio dice se vale la pena studiarli, non se è il momento tecnico giusto: per quello c&apos;è <Link href="/scanner">Minervini SCAN</Link>.
          <InfoTip
            label="Come funziona il punteggio"
            source="Yahoo Finance, Finnhub, SEC EDGAR, STOCK Act, elenco pubblico dei parlamentari"
            formula="media di Persone, Qualità e Momento; un pilastro che non si riesce a misurare resta fuori dalla media"
          >
            <strong>Tre pilastri, da 0 a 100</strong>
            <span>
              <strong>Persone</strong>: acquisti di politici e di dirigenti (solo USA); le vendite dei dirigenti abbassano il voto.
            </span>
            <span>
              <strong>Qualità</strong>: rendimento del capitale, margini, crescita degli utili, debito e prezzo rispetto alla crescita.
            </span>
            <span>
              <strong>Momento</strong>: c&apos;è ancora tempo? Scende se il titolo ha già corso molto, se è molto in basso nell&apos;anno o se la trimestrale è vicina.
            </span>
            <span>Non è un consiglio d&apos;acquisto. Una scansione parte ogni sera nei giorni di Borsa; con «Scansiona ora» puoi farla subito (fino a un minuto).</span>
          </InfoTip>
        </p>
        <ScanButton />
        <Suspense fallback={<SectionSkeleton label="Carico i candidati…" variant="cards" />}>
          <AuthGate path="/scopri">
            <Candidates searchParams={searchParams} />
          </AuthGate>
        </Suspense>
      </section>
    </main>
  )
}
