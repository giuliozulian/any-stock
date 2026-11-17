import { Suspense } from 'react'
import { SectionSkeleton } from '@/components/SectionSkeleton'
import { connection } from 'next/server'
import Link from 'next/link'
import { getRecentCongressBuys, getRecentCongressSellers, clusterBuys, type CongressBuy } from '@/lib/congress'
import { withMarketReturn } from '@/lib/congress-benchmark'
import { InfoTip } from '@/components/InfoTip'
import { MemberName, type MemberCard } from '@/components/MemberName'
import { getMemberProfiles, memberStats } from '@/lib/politician-profiles'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/watchlist'
import { rankSignals, topMembers, lagDays, daysSince, FILING_DEADLINE_DAYS, type Timing } from '@/lib/congress-signals'
import table from '../movimenti/movimenti.module.css'
import styles from '../section.module.css'
import local from './politici.module.css'
import { AuthGate } from '@/components/AuthGate'

type Search = { camera?: string; partito?: string; lista?: string }

const short = (v: number) => (v >= 1_000_000 ? `${+(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}k` : String(v))
const day = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—')
const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const amount = (low: number, high: number) => (high > 0 ? `$${short(low)} – $${short(high)}` : '—')
const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`
const BIG_BUY_MIN = 50_000
const FRESH_DAYS = 7
const STALE_FEED_DAYS = 10
const TIMING_LABEL: Record<Timing, string | null> = { early: 'Ancora in tempo', running: 'Già in movimento', late: 'Già salito molto', unknown: null }
const TIMING_CLASS: Partial<Record<Timing, string>> = { early: local.early, late: local.late }

const CHAMBERS = [
  { key: 'tutte', label: 'Tutte le camere' },
  { key: 'house', label: 'Camera' },
  { key: 'senate', label: 'Senato' },
] as const
const PARTIES = [
  { key: 'tutti', label: 'Tutti i partiti', value: '' },
  { key: 'dem', label: 'Democratici', value: 'Democratico' },
  { key: 'rep', label: 'Repubblicani', value: 'Repubblicano' },
] as const
const SECTIONS = [
  { id: 'adesso', label: 'Da approfondire' },
  { id: 'migliori', label: 'Chi ha scelto meglio' },
  { id: 'piu-politici', label: 'Più politici' },
  { id: 'grossi', label: 'Più grossi' },
  { id: 'nuovi', label: 'Appena pubblicati' },
]

// Return since the purchase, then how far it is from simply holding the S&P 500 over the same days: the second number is the one that says if it was a good pick.
function Perf({ pct, market, excess }: { pct: number | null; market?: number | null; excess?: number | null }) {
  if (pct === null) return null
  const above = excess ?? (typeof market === 'number' ? pct - market : null)
  return (
    <span className={local.perf}>
      <span className={pct >= 0 ? styles.gain : styles.loss}>{signed(pct)}% da quando hanno comprato</span>
      {above !== null && <span className={above >= 0 ? styles.gain : styles.loss}>{`${signed(above)} punti rispetto all’S&P 500`}</span>}
    </span>
  )
}

function Lag({ buy }: { buy: Pick<CongressBuy, 'date' | 'disclosedAt'> }) {
  const lag = lagDays(buy)
  if (lag === null) return null
  return <span className={lag > FILING_DEADLINE_DAYS ? local.lagLate : undefined}>{`dichiarato dopo ${lag} ${lag === 1 ? 'giorno' : 'giorni'}`}</span>
}

async function CongressBuys({ searchParams }: { searchParams: Promise<Search> }) {
  await connection()
  const params = await searchParams
  const chamber = CHAMBERS.find((c) => c.key === params.camera)?.key ?? 'tutte'
  const party = PARTIES.find((p) => p.key === params.partito) ?? PARTIES[0]
  const onlyWatched = params.lista === '1'

  const allBuys = await getRecentCongressBuys()
  if (allBuys === null) return <p className={styles.empty}>Non riesco a scaricare le operazioni dei politici in questo momento. Riprova tra qualche minuto.</p>
  if (allBuys.length === 0) return <p className={styles.empty}>Nessun acquisto dichiarato di recente.</p>

  const people = new Map<string, { member: string; chamber: string; state: string }>()
  for (const b of allBuys) if (!people.has(b.member)) people.set(b.member, { member: b.member, chamber: b.chamber, state: b.state })
  const [enriched, sellers, profiles, watched] = await Promise.all([
    withMarketReturn(allBuys),
    getRecentCongressSellers().catch(() => null),
    getMemberProfiles([...people.values()]),
    currentUserId().then((userId) => prisma.stock.findMany({ where: { watchers: { some: { userId } } }, select: { symbol: true } })),
  ])
  const watchSet = new Set(watched.map((w) => w.symbol.toUpperCase()))
  // Track records use every purchase; the filters below only decide what is listed.
  const stats = memberStats(enriched)
  const buys = enriched
    .filter((b) => chamber === 'tutte' || b.chamber === chamber)
    .filter((b) => !party.value || profiles.get(b.member)?.party === party.value)
    .filter((b) => !onlyWatched || watchSet.has(b.ticker.toUpperCase()))

  const href = (over: Partial<{ camera: string; partito: string; lista: string }>) => {
    const q = new URLSearchParams({ camera: chamber, partito: party.key })
    if (onlyWatched) q.set('lista', '1')
    for (const [k, v] of Object.entries(over)) {
      if (v === '') q.delete(k)
      else q.set(k, v)
    }
    return `/politici?${q.toString()}`
  }

  const person = (name: string) => {
    const p = people.get(name)
    const prof = profiles.get(name)
    const st = stats.get(name)
    const card: MemberCard = {
      name,
      chamber: p?.chamber ?? '',
      state: p?.state ?? '',
      party: prof?.party ?? '',
      role: prof?.role ?? '',
      influence: prof?.influence ?? '',
      note: prof?.note ?? '',
      purchases: st?.purchases ?? 0,
      tickers: st?.tickers ?? 0,
      avgPerfPct: st?.avgPerfPct ?? null,
      avgExcessPct: st?.avgExcessPct ?? null,
    }
    return <MemberName card={card} />
  }
  const symbolLink = (t: string) => <Link href={`/stock/${encodeURIComponent(t)}`}>{t}</Link>
  const memberList = (members: string[]) =>
    members.map((m, k) => (
      <span key={m}>
        {k > 0 && ', '}
        {person(m)}
      </span>
    ))

  const newestDisclosure = allBuys[0].disclosedAt
  const feedAgeDays = daysSince(newestDisclosure)
  const signals = rankSignals(buys, profiles, stats, undefined, sellers ?? undefined).slice(0, 10)
  const leaders = topMembers(stats)
  const clusters = clusterBuys(buys).slice(0, 12)
  const big = buys
    .filter((b) => b.amountLow >= BIG_BUY_MIN)
    .sort((a, b) => b.amountHigh - a.amountHigh || b.disclosedAt.localeCompare(a.disclosedAt))
    .slice(0, 10)
  const cutoff = new Date(new Date(`${newestDisclosure}T00:00:00Z`).getTime() - FRESH_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const fresh = buys.filter((b) => b.disclosedAt >= cutoff).slice(0, 30)
  const filtered = chamber !== 'tutte' || party.value !== '' || onlyWatched

  return (
    <>
      <div className={local.summary}>
        <p>
          <strong>{buys.length}</strong> acquisti di <strong>{new Set(buys.map((b) => b.member)).size}</strong> politici
          {filtered && ` (su ${allBuys.length} totali)`}. Ultima dichiarazione pubblicata il {longDay(newestDisclosure)}.
        </p>
        {feedAgeDays > STALE_FEED_DAYS && (
          <p className={local.warn}>L’ultima dichiarazione risale a {feedAgeDays} giorni fa: la fonte potrebbe essere ferma o aver raggiunto il limite giornaliero.</p>
        )}
        <p className={local.sources}>
          Dichiarazioni: Bargo, dagli archivi ufficiali della <a href="https://disclosures-clerk.house.gov/FinancialDisclosure" target="_blank" rel="noopener noreferrer">Camera</a> e del{' '}
          <a href="https://efdsearch.senate.gov/search/" target="_blank" rel="noopener noreferrer">Senato</a>. Partiti e commissioni: elenco pubblico dei parlamentari in carica. Prezzi: Yahoo Finance.
        </p>
      </div>

      <nav className={local.jump} aria-label="Sezioni della pagina">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.label}
          </a>
        ))}
      </nav>

      <div className={table.filters}>
        <nav className={table.group} aria-label="Camera">
          {CHAMBERS.map((c) => (
            <Link key={c.key} href={href({ camera: c.key })} aria-current={c.key === chamber ? 'page' : undefined}>
              {c.label}
            </Link>
          ))}
        </nav>
        <nav className={table.group} aria-label="Partito">
          {PARTIES.map((p) => (
            <Link key={p.key} href={href({ partito: p.key })} aria-current={p.key === party.key ? 'page' : undefined}>
              {p.label}
            </Link>
          ))}
        </nav>
        <nav className={table.group} aria-label="Watchlist">
          <Link href={href({ lista: onlyWatched ? '' : '1' })} aria-current={onlyWatched ? 'page' : undefined}>
            Solo watchlist
          </Link>
        </nav>
      </div>
      {party.value && <p className={local.note}>Chi non è più in carica non ha un partito nell’elenco e resta fuori da questo filtro.</p>}

      {buys.length === 0 ? (
        <p className={styles.empty}>Nessun acquisto corrisponde ai filtri scelti. Togline qualcuno.</p>
      ) : (
        <>
          <section id="adesso" className={styles.section}>
            <h2 className={styles.heading}>
              Da approfondire adesso
              <InfoTip
                label="Come è calcolata la classifica"
                source="Bargo (dichiarazioni STOCK Act), prezzi Yahoo Finance, partiti e commissioni dall’elenco pubblico dei parlamentari"
                formula="punti per numero di politici diversi, importi, pubblicazione recente, commissioni chiave, storico di chi compra; bonus se il prezzo è salito poco dall'acquisto, malus se è già salito oltre il 20% o se altri politici vendono lo stesso titolo"
              >
                <strong>Una classifica per decidere dove guardare per primo</strong>
                <span>Non è un consiglio di acquisto: i dati arrivano fino a 45 giorni dopo l&apos;operazione. Serve a mettere in cima i titoli con più segnali insieme.</span>
                <span>Accanto al rendimento vedi quanto è sopra o sotto l’S&amp;P 500 negli stessi giorni: un titolo +8% quando il mercato fa +10% non è una buona scelta.</span>
              </InfoTip>
            </h2>
            <p className={styles.lead}>Titoli con più segnali insieme. «Ancora in tempo» significa che da quando hanno comprato il prezzo è salito di poco.</p>
            {signals.length === 0 ? (
              <p className={styles.empty}>Nessun titolo con segnali abbastanza forti al momento.</p>
            ) : (
              <ul className={styles.list}>
                {signals.map((s) => (
                  <li key={s.ticker} className={local.signal}>
                    <div className={local.signalHead}>
                      <span className={local.ticker}>{symbolLink(s.ticker)}</span>
                      <span className={styles.sub}>{s.asset}</span>
                      <span className={local.tags}>
                        {watchSet.has(s.ticker.toUpperCase()) && <span className={`${local.tag} ${local.watch}`}>In watchlist</span>}
                        {TIMING_LABEL[s.timing] && <span className={`${local.tag} ${TIMING_CLASS[s.timing] ?? ''}`}>{TIMING_LABEL[s.timing]}</span>}
                        {s.sellers > 0 && <span className={`${local.tag} ${local.late}`}>{s.sellers === 1 ? 'Venduto da un altro politico' : `Venduto da altri ${s.sellers} politici`}</span>}
                        {s.maxLagDays > FILING_DEADLINE_DAYS && <span className={`${local.tag} ${local.late}`}>Dichiarato in ritardo</span>}
                      </span>
                    </div>
                    <p className={local.members}>{memberList(s.members)}</p>
                    {s.reasons.length > 0 && (
                      <ul className={local.reasons} aria-label="Perché è in classifica">
                        {s.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                    <p className={local.facts}>
                      <span>{amount(s.totalLow, s.totalHigh)}</span>
                      <span>
                        comprato dal {day(s.firstDate)}, pubblicato il {day(s.lastDisclosedAt)}
                      </span>
                      <Perf pct={s.avgPerfPct} excess={s.avgExcessPct} />
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {leaders.length > 0 && (
            <section id="migliori" className={styles.section}>
              <h2 className={styles.heading}>Chi ha scelto meglio</h2>
              <p className={styles.lead}>
                Politici con almeno 3 acquisti recenti, in ordine di quanto hanno battuto l’S&amp;P 500 da quando hanno comprato. Il campione è piccolo (pochi mesi): è un indizio, non una prova di bravura.
              </p>
              <ul className={local.follow}>
                {leaders.map((l) => (
                  <li key={l.member}>
                    {person(l.member)}
                    <Perf pct={l.avgPerfPct} excess={l.avgExcessPct} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="piu-politici" className={styles.section}>
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
                      {c.members.length} politici: {memberList(c.members)}
                    </span>
                    <span className={styles.side}>
                      {amount(c.totalLow, c.totalHigh)} in totale, pubblicato il {day(c.lastDisclosedAt)}
                      <br />
                      <Perf pct={c.avgPerfPct} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section id="grossi" className={styles.section}>
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
                      {person(b.member)}, {amount(b.amountLow, b.amountHigh)}
                    </span>
                    <span className={styles.side}>
                      comprato il {day(b.date)}, <Lag buy={b} />
                      <br />
                      <Perf pct={b.perfPct} market={b.marketPct} />
                      {b.portal && (
                        <>
                          <br />
                          <a href={b.portal} target="_blank" rel="noopener noreferrer" className={local.source}>
                            Dichiarazione ufficiale
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section id="nuovi" className={styles.section}>
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
                      <span className={styles.sub}>{b.asset}</span>
                      <span className={local.members}>{person(b.member)}</span>
                    </span>
                    <span className={styles.side}>
                      {amount(b.amountLow, b.amountHigh)}
                      <br />
                      comprato il {day(b.date)}, <Lag buy={b} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  )
}

export default function PoliticiPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Cosa comprano i politici americani</h1>
      <Suspense fallback={<SectionSkeleton label="Carico le operazioni…" variant="list" />}>
        <AuthGate path="/politici">
          <CongressBuys searchParams={searchParams} />
        </AuthGate>
      </Suspense>
    </main>
  )
}
