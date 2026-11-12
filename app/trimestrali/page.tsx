import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { getEarningsCalendar, type EarningsEvent } from '@/lib/finnhub'
import table from '../movimenti/movimenti.module.css'
import local from './trimestrali.module.css'
import styles from '../section.module.css'

type Search = { giorni?: string; vista?: string; ordina?: string; dir?: string }
type SortKey = 'date' | 'sym' | 'eps' | 'rev'
type View = 'watch' | 'big' | 'all'

const DAYS = [7, 14, 30]
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'watch', label: 'Solo watchlist' },
  { key: 'big', label: 'Watchlist e grandi aziende' },
  { key: 'all', label: 'Tutte' },
]
const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: 'date', label: 'Data', numeric: false },
  { key: 'sym', label: 'Titolo', numeric: false },
  { key: 'eps', label: 'EPS atteso', numeric: true },
  { key: 'rev', label: 'Ricavi attesi', numeric: true },
]
const BIG_REVENUE = 1e9
const MAX_ROWS = 500
const HOUR_LABEL: Record<string, string> = { bmo: 'prima dell’apertura', amc: 'dopo la chiusura', dmh: 'durante la seduta' }

const dayFormat: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }

function formatDay(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('it-IT', dayFormat)
}

function formatRevenue(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} mld $`
  return `${(n / 1e6).toFixed(0)} mln $`
}

function sortValue(e: EarningsEvent, key: SortKey): number | string {
  switch (key) {
    case 'sym':
      return e.symbol
    case 'eps':
      return e.epsEstimate ?? -Infinity
    case 'rev':
      return e.revenueEstimate ?? -1
    default:
      return e.date
  }
}

async function EarningsCalendar({ searchParams }: { searchParams: Promise<Search> }) {
  await connection()
  const params = await searchParams
  const days = DAYS.includes(Number(params.giorni)) ? Number(params.giorni) : 14
  const view = VIEWS.find((v) => v.key === params.vista)?.key ?? 'big'
  const sortKey: SortKey = COLUMNS.find((c) => c.key === params.ordina)?.key ?? 'date'
  const sortDir: 'asc' | 'desc' = params.dir === 'desc' ? 'desc' : 'asc'

  const now = new Date()
  const from = now.toISOString().slice(0, 10)
  const to = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [watched, calendar] = await Promise.all([
    prisma.stock.findMany({ select: { symbol: true, name: true } }),
    getEarningsCalendar(from, to).then(
      (events) => ({ events, failed: false }),
      (err) => {
        console.error('Earnings calendar failed:', err instanceof Error ? err.message : err)
        return { events: [] as EarningsEvent[], failed: true }
      }
    ),
  ])
  const names = new Map(watched.map((s) => [s.symbol, s.name]))
  const filtered = calendar.events.filter((e) => {
    if (names.has(e.symbol)) return true
    if (view === 'watch') return false
    return view === 'all' || (e.revenueEstimate ?? 0) >= BIG_REVENUE
  })
  const total = filtered.length
  const rows = [...filtered]
    .sort((a, b) => (b.revenueEstimate ?? 0) - (a.revenueEstimate ?? 0))
    .slice(0, MAX_ROWS)
    .sort((a, b) => {
      const x = sortValue(a, sortKey)
      const y = sortValue(b, sortKey)
      const cmp = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)
      return (sortDir === 'asc' ? cmp : -cmp) || a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol)
    })

  const href = (over: Partial<{ giorni: number; vista: string; ordina: string; dir: string }>) =>
    `/trimestrali?${new URLSearchParams({ giorni: String(days), vista: view, ordina: sortKey, dir: sortDir, ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) }).toString()}`

  return (
    <section className={styles.section}>
      <p className={styles.lead}>
        Il programma delle trimestrali di tutto il mercato, con i titoli che segui evidenziati e sottolineati. Le date sono quelle comunicate dalle aziende e possono cambiare.
      </p>
      <div className={table.filters}>
        <nav className={table.group} aria-label="Periodo">
          {DAYS.map((d) => (
            <Link key={d} href={href({ giorni: d })} aria-current={d === days ? 'page' : undefined}>
              {d} giorni
            </Link>
          ))}
        </nav>
        <nav className={table.group} aria-label="Quali titoli">
          {VIEWS.map((v) => (
            <Link key={v.key} href={href({ vista: v.key })} aria-current={v.key === view ? 'page' : undefined}>
              {v.label}
            </Link>
          ))}
        </nav>
        <a className={local.cta} href="/api/calendar">
          Aggiungi al calendario
        </a>
      </div>
      <p className={local.hint}>
        Il pulsante scarica un file .ics con le trimestrali della tua watchlist: aprilo sull&apos;iPhone o sul Mac per aggiungerle al Calendario. Come grandi aziende considero quelle con ricavi attesi di almeno 1 mld $.
      </p>
      {calendar.failed ? (
        <p className={styles.empty}>Non riesco a scaricare il calendario in questo momento. Riprova tra qualche minuto.</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>Nessuna trimestrale in questo periodo con questo filtro. Prova ad allargare il periodo o a scegliere «Tutte».</p>
      ) : (
        <>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead>
                <tr>
                  {COLUMNS.map((c) => {
                    const active = c.key === sortKey
                    const nextDir = active && sortDir === 'asc' ? 'desc' : 'asc'
                    return (
                      <th key={c.key} scope="col" className={c.numeric ? table.num : undefined} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <Link href={href({ ordina: c.key, dir: !active && c.numeric ? 'desc' : nextDir })} className={table.sort} data-active={active || undefined}>
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
                {rows.map((e) => {
                  const watchedName = names.get(e.symbol)
                  return (
                    <tr key={`${e.symbol}-${e.date}`} className={watchedName ? local.watched : undefined}>
                      <td>
                        {formatDay(e.date)}
                        {e.hour && HOUR_LABEL[e.hour] ? <span className={table.name}>{HOUR_LABEL[e.hour]}</span> : null}
                      </td>
                      <td>
                        <Link href={`/stock/${encodeURIComponent(e.symbol)}`} className={table.symbol}>
                          {e.symbol}
                        </Link>
                        {watchedName ? <span className={table.name}>{watchedName} · in watchlist</span> : null}
                      </td>
                      <td className={table.num}>{e.epsEstimate !== null ? e.epsEstimate.toFixed(2) : '–'}</td>
                      <td className={table.num}>{e.revenueEstimate ? formatRevenue(e.revenueEstimate) : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {total > MAX_ROWS && <p className={local.hint}>Mostro le {MAX_ROWS} aziende con più ricavi attesi su {total}.</p>}
        </>
      )}
    </section>
  )
}

export default function EarningsPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Calendario trimestrali</h1>
      <Suspense fallback={<p className={styles.empty}>Carico le trimestrali…</p>}>
        <EarningsCalendar searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
