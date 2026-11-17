import { Suspense } from 'react'
import { SectionSkeleton } from '@/components/SectionSkeleton'
import { connection, after } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/watchlist'
import { getMarketSnapshot, bigMovers, isMarketLive, BIG_MOVE_THRESHOLD_PCT, MIN_MARKET_CAP, type Market, type MarketMover, type MarketSnapshot } from '@/lib/market'
import { ensureMoveExplanations, getMoveExplanations, isStale, tradingDay, type MoveSource } from '@/lib/move-explanation'
import { InfoTip } from '@/components/InfoTip'
import { MoversRefresh } from '@/components/MoversRefresh'
import styles from '../section.module.css'
import table from './movimenti.module.css'
import { AuthGate } from '@/components/AuthGate'

function formatMoney(n: number, currency: string): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} mld ${currency}`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} mln ${currency}`
  return `${n.toFixed(0)} ${currency}`
}

const THRESHOLDS = [3, 5, 10, 15]
const MARKETS: Array<{ key: Market; label: string; currency: string; timeZone: string }> = [
  { key: 'us', label: 'USA', currency: '$', timeZone: 'America/New_York' },
  { key: 'it', label: 'Italia', currency: '€', timeZone: 'Europe/Rome' },
  { key: 'cn', label: 'Cina', currency: '¥', timeZone: 'Asia/Shanghai' },
]
const SIDES = [
  { key: 'tutti', label: 'Tutti' },
  { key: 'su', label: 'Rialzo' },
  { key: 'giu', label: 'Ribasso' },
] as const
type Side = (typeof SIDES)[number]['key']
type Search = { soglia?: string; mercato?: string; ordina?: string; dir?: string; lato?: string; lista?: string; rvol?: string }

const HIGH_RELATIVE_VOLUME = 2

type SortKey = 'var' | 'sym' | 'price' | 'cap' | 'vol' | 'rvol'
const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: 'var', label: 'Variazione', numeric: true },
  { key: 'sym', label: 'Titolo', numeric: false },
  { key: 'price', label: 'Prezzo', numeric: true },
  { key: 'cap', label: 'Capitalizzazione', numeric: true },
  { key: 'vol', label: 'Volume', numeric: true },
  { key: 'rvol', label: 'Vol. relativo', numeric: true },
]

function sortValue(m: MarketMover, key: SortKey): number | string {
  switch (key) {
    case 'sym':
      return m.symbol
    case 'price':
      return m.price
    case 'cap':
      return m.marketCap ?? -1
    case 'vol':
      return m.volume ?? -1
    case 'rvol':
      return m.relVolume ?? -1
    default:
      return Math.abs(m.changePct)
  }
}

function formatVolume(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} mln`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} mila`
  return String(n)
}

function statusLine(snapshot: MarketSnapshot, timeZone: string): string {
  const at = snapshot.asOf ?? snapshot.fetchedAt
  const time = new Intl.DateTimeFormat('it-IT', { timeZone, hour: '2-digit', minute: '2-digit' }).format(at)
  const date = new Intl.DateTimeFormat('it-IT', { timeZone, day: 'numeric', month: 'long' }).format(at)
  if (isMarketLive(snapshot.marketState)) return `Seduta in corso · dati delle ${time}`
  return `Mercato chiuso · variazioni della seduta del ${date}`
}

function Why({ explanation, confidence, kind, sources }: { explanation: string; confidence: string; kind: string; sources: MoveSource[] }) {
  return (
    <p className={table.why}>
      <span className={table.whyTag} data-kind={kind}>
        {kind === 'fact' ? 'Dato' : 'IA'}
      </span>
      {explanation}
      {confidence === 'uncertain' && <span className={table.whyNote}> Causa non chiara dalle notizie.</span>}
      {sources.length > 0 && (
        <span className={table.sources}>
          {sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
              {s.title}
            </a>
          ))}
        </span>
      )}
    </p>
  )
}

async function BigMovers({ searchParams }: { searchParams: Promise<Search> }) {
  await connection()
  const { soglia, mercato, ordina, dir, lato, lista, rvol } = await searchParams
  const sortKey: SortKey = COLUMNS.find((c) => c.key === ordina)?.key ?? 'var'
  const sortDir: 'asc' | 'desc' = dir === 'asc' ? 'asc' : 'desc'
  const market = MARKETS.find((m) => m.key === mercato) ?? MARKETS[0]
  const parsed = Number(soglia)
  const threshold = THRESHOLDS.includes(parsed) ? parsed : BIG_MOVE_THRESHOLD_PCT
  const side: Side = SIDES.find((s) => s.key === lato)?.key ?? 'tutti'
  const onlyWatched = lista === '1'
  const onlyHighVolume = rvol === '1'
  const [watched, marketResult] = await Promise.all([
    currentUserId().then((userId) => prisma.stock.findMany({ where: { watchers: { some: { userId } } }, select: { symbol: true } })),
    getMarketSnapshot(market.key).then(
      (snapshot) => ({ snapshot, failed: false }),
      (err) => {
        console.error('Market movers failed:', err instanceof Error ? err.message : err)
        return { snapshot: null, failed: true }
      }
    ),
  ])
  const watchedSymbols = new Set(watched.map((s) => s.symbol))
  const { snapshot, failed } = marketResult
  const all = snapshot ? snapshot.movers : []
  const countAt = (t: number) => bigMovers(all, t).length
  const aboveThreshold = bigMovers(all, threshold)
  const up = aboveThreshold.filter((m) => m.changePct > 0).length
  const down = aboveThreshold.length - up
  const movers = aboveThreshold
    .filter((m) => (side === 'su' ? m.changePct > 0 : side === 'giu' ? m.changePct < 0 : true))
    .filter((m) => !onlyWatched || watchedSymbols.has(m.symbol))
    .filter((m) => !onlyHighVolume || (m.relVolume ?? 0) >= HIGH_RELATIVE_VOLUME)
    .sort((a, b) => {
      const x = sortValue(a, sortKey)
      const y = sortValue(b, sortKey)
      const cmp = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)
      return sortDir === 'asc' ? cmp : -cmp
    })
  // News come from Finnhub, so only US stocks are explained. The biggest moves are explained, whatever the sort or filters on screen; generation runs after the response.
  const day = tradingDay(new Date(), market.timeZone)
  const explainable = market.key === 'us' ? aboveThreshold : []
  const explanations = await getMoveExplanations(explainable.map((m) => m.symbol), day).catch(() => new Map())
  if (explainable.length > 0) {
    const pending = explainable.filter((m) => {
      const row = explanations.get(m.symbol)
      return !row || isStale(row, m.changePct)
    })
    if (pending.length > 0) after(() => ensureMoveExplanations(pending))
  }
  const href = (over: Partial<{ mercato: string; soglia: number; ordina: string; dir: string; lato: string; lista: string; rvol: string }>) => {
    const base: Record<string, string> = { mercato: market.key, soglia: String(threshold), ordina: sortKey, dir: sortDir, lato: side }
    if (onlyWatched) base.lista = '1'
    if (onlyHighVolume) base.rvol = '1'
    const q = new URLSearchParams(base)
    for (const [k, v] of Object.entries(over)) {
      if (v === '') q.delete(k)
      else q.set(k, String(v))
    }
    return `/movimenti?${q.toString()}`
  }
  const sortHref = (c: (typeof COLUMNS)[number]) => {
    const active = c.key === sortKey
    return href({ ordina: c.key, dir: c.key === 'sym' && !active ? 'asc' : active && sortDir === 'desc' ? 'asc' : 'desc' })
  }
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        Movimenti forti
        <InfoTip
          label="Cos’è questa sezione"
          source="Yahoo Finance, screener sulle borse USA (Nasdaq, NYSE, NYSE American), Borsa Italiana, Shanghai e Shenzhen. Le notizie per le spiegazioni vengono da Finnhub, i documenti da SEC EDGAR"
          formula={`Compare un titolo se la variazione della seduta è almeno ±${threshold}%, il prezzo è almeno 1, la capitalizzazione almeno ${formatMoney(MIN_MARKET_CAP[market.key], market.currency)} e il volume almeno 50 mila. Il volume relativo è il volume di oggi diviso la media dei 3 mesi.`}
        >
          <strong>Movimenti forti</strong>
          <span>Titoli che nella seduta hanno guadagnato o perso almeno il {threshold}%, non solo quelli che segui.</span>
          <span>Ho escluso i titoli sotto 1, i titoli piccoli (sotto {formatMoney(MIN_MARKET_CAP[market.key], market.currency)} di capitalizzazione), i volumi minuscoli e warrant, diritti e simili. La Cina ha un limite giornaliero del 10-20%. Yahoo restituisce al massimo i 100 titoli che salgono e i 100 che scendono di più.</span>
          <span>Un movimento forte con volume relativo basso (sotto 1×) di solito è rumore; sopra 2× è un segnale più solido.</span>
          <span>Le spiegazioni, solo per gli USA e per i movimenti maggiori: «Dato» viene dai risultati trimestrali o dai documenti SEC, «IA» è un riassunto delle notizie con i link usati. Controllale sempre sulla fonte.</span>
        </InfoTip>
      </h2>
      <p className={styles.lead}>
        Titoli di tutto il mercato ({market.label}) che nella seduta si sono mossi di almeno il {threshold}%. Quelli in watchlist sono segnati.
      </p>
      {snapshot && (
        <p className={table.status}>
          <span data-live={isMarketLive(snapshot.marketState) || undefined}>{statusLine(snapshot, market.timeZone)}</span>
          <MoversRefresh live={isMarketLive(snapshot.marketState)} />
        </p>
      )}
      <div className={table.filters}>
        <nav className={table.group} aria-label="Mercato">
          {MARKETS.map((m) => (
            <Link key={m.key} href={href({ mercato: m.key })} aria-current={m.key === market.key ? 'page' : undefined}>
              {m.label}
            </Link>
          ))}
        </nav>
        <nav className={table.group} aria-label="Soglia di variazione">
          {THRESHOLDS.map((t) => (
            <Link key={t} href={href({ soglia: t })} aria-current={t === threshold ? 'page' : undefined}>
              ±{t}%{snapshot && <span className={table.count}>{countAt(t)}</span>}
            </Link>
          ))}
        </nav>
        <nav className={table.group} aria-label="Direzione">
          {SIDES.map((s) => (
            <Link key={s.key} href={href({ lato: s.key })} aria-current={s.key === side ? 'page' : undefined}>
              {s.label}
            </Link>
          ))}
        </nav>
        <nav className={table.group} aria-label="Filtri">
          <Link href={href({ lista: onlyWatched ? '' : '1' })} aria-current={onlyWatched ? 'page' : undefined}>
            Solo watchlist
          </Link>
          <Link href={href({ rvol: onlyHighVolume ? '' : '1' })} aria-current={onlyHighVolume ? 'page' : undefined}>
            Volume ≥{HIGH_RELATIVE_VOLUME}×
          </Link>
        </nav>
      </div>
      {snapshot && aboveThreshold.length > 0 && (
        <p className={table.summary}>
          <span className={styles.gain}>{up} in rialzo</span> · <span className={styles.loss}>{down} in ribasso</span>
          {movers.length !== aboveThreshold.length && ` · ${movers.length} con i filtri scelti`}
        </p>
      )}
      <nav className={table.sortBar} aria-label="Ordina per">
        <span>Ordina per</span>
        {COLUMNS.map((c) => (
          <Link key={c.key} href={sortHref(c)} data-active={c.key === sortKey || undefined}>
            {c.label}
            {c.key === sortKey && (sortDir === 'asc' ? ' ▲' : ' ▼')}
          </Link>
        ))}
      </nav>
      {failed ? (
        <p className={styles.empty}>Non riesco a scaricare le classifiche del mercato in questo momento. Riprova tra qualche minuto.</p>
      ) : movers.length === 0 ? (
        <p className={styles.empty}>
          {aboveThreshold.length === 0 ? `Nessun titolo ha superato ±${threshold}% nella seduta. Prova una soglia più bassa.` : 'Nessun titolo corrisponde ai filtri scelti. Togline qualcuno.'}
        </p>
      ) : (
        <div className={table.wrap}>
          <table className={table.table}>
            <thead>
              <tr>
                {COLUMNS.map((c) => {
                  const active = c.key === sortKey
                  return (
                    <th key={c.key} scope="col" className={c.numeric ? table.num : undefined} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <Link href={sortHref(c)} className={table.sort} data-active={active || undefined}>
                        {c.label}
                        <span aria-hidden="true" className={table.arrow}>
                          {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </Link>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {movers.map((m) => {
                const why = explanations.get(m.symbol)
                return (
                  <tr key={m.symbol}>
                    <td data-label="Variazione" className={`${table.num} ${table.change} ${m.changePct >= 0 ? styles.gain : styles.loss}`}>
                      {m.changePct >= 0 ? '+' : '−'}
                      {Math.abs(m.changePct).toFixed(2)}%
                    </td>
                    <td className={table.title}>
                      <Link href={`/stock/${encodeURIComponent(m.symbol)}`} className={table.symbol}>
                        {m.symbol}
                      </Link>
                      <span className={table.name}>{m.name}</span>
                      {watchedSymbols.has(m.symbol) && <span className={table.badge}>in watchlist</span>}
                      {why && <Why explanation={why.explanation} confidence={why.confidence} kind={why.kind} sources={(why.sources ?? []) as unknown as MoveSource[]} />}
                    </td>
                    <td data-label="Prezzo" className={table.num}>
                      {market.currency}
                      {m.price.toFixed(2)}
                    </td>
                    <td data-label="Cap." className={table.num}>{m.marketCap ? formatMoney(m.marketCap, market.currency) : '–'}</td>
                    <td data-label="Volume" className={table.num}>{m.volume ? formatVolume(m.volume) : '–'}</td>
                    <td data-label="Vol. rel." className={table.num} data-low={(m.relVolume !== null && m.relVolume < 1) || undefined} data-high={(m.relVolume !== null && m.relVolume >= HIGH_RELATIVE_VOLUME) || undefined}>
                      {m.relVolume === null ? '–' : `${m.relVolume.toFixed(1)}×`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {market.key !== 'us' && <p className={table.note}>Le spiegazioni dei movimenti sono disponibili solo per gli USA.</p>}
    </section>
  )
}

export default function MoversPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Movimenti forti</h1>
      <Suspense fallback={<SectionSkeleton label="Carico i movimenti…" variant="list" />}>
        <AuthGate path="/movimenti">
          <BigMovers searchParams={searchParams} />
        </AuthGate>
      </Suspense>
    </main>
  )
}
