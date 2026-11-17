import { Suspense } from 'react'
import { SectionSkeleton } from '@/components/SectionSkeleton'
import { connection } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/watchlist'
import type { EarningsEvent } from '@/lib/finnhub'
import { compareEvents, getEarningsFeed, getTypicalMove, quoteReaction, reactionFromBars, slotOf, surprise, tierOf, type Slot, type Tier, type Verdict } from '@/lib/earnings'
import { getQuoteInfo, type QuoteInfo } from '@/lib/quote-info'
import { tradingDay } from '@/lib/move-explanation'
import table from '../movimenti/movimenti.module.css'
import local from './trimestrali.module.css'
import styles from '../section.module.css'
import { AuthGate } from '@/components/AuthGate'

type Search = { periodo?: string; giorni?: string; vista?: string; q?: string }
type View = 'watch' | 'big' | 'all'
type Period = 'prossime' | 'uscite'

const DAYS = [7, 14, 30]
const REPORTED_DAYS = 7
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'watch', label: 'Solo watchlist' },
  { key: 'big', label: 'Watchlist e grandi aziende' },
  { key: 'all', label: 'Tutte' },
]
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'prossime', label: 'In arrivo' },
  { key: 'uscite', label: 'Appena uscite' },
]
const SLOTS: Array<{ key: Slot; label: string }> = [
  { key: 'bmo', label: 'Prima dell’apertura' },
  { key: 'dmh', label: 'Durante la seduta' },
  { key: 'amc', label: 'Dopo la chiusura' },
  { key: 'unknown', label: 'Orario non indicato' },
]
// Finnhub quotes only US companies and only they have a revenue estimate worth a market-cap lookup.
const MIN_REVENUE_FOR_LOOKUP = 100_000_000

interface Row {
  e: EarningsEvent
  tier: Tier
  info: QuoteInfo | undefined
  typical: number | null
  reaction: number | null
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const utcDate = (d: string) => new Date(`${d}T00:00:00Z`)

function dayHeading(day: string, today: string): string {
  const text = utcDate(day).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  if (day === today) return `Oggi, ${text}`
  if (day === addDays(today, 1)) return `Domani, ${text}`
  if (day === addDays(today, -1)) return `Ieri, ${text}`
  return text
}

function money(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} mila mld $`
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} mld $`
  return `${(n / 1e6).toFixed(0)} mln $`
}

const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}%`
const VERDICT_LABEL: Record<Verdict, string> = { beat: 'Sopra le attese', miss: 'Sotto le attese', inline: 'In linea' }

function Metrics({ row, reported }: { row: Row; reported: boolean }) {
  const { e } = row
  if (reported) {
    const s = surprise(e.epsActual, e.epsEstimate)
    return (
      <dl className={local.metrics}>
        <div>
          <dt>EPS</dt>
          <dd>
            {e.epsActual!.toFixed(2)}
            {e.epsEstimate !== null && <span className={local.sub}> atteso {e.epsEstimate.toFixed(2)}</span>}
          </dd>
        </div>
        {s && (
          <div>
            <dt>Rispetto alle attese</dt>
            <dd className={s.verdict === 'beat' ? styles.gain : s.verdict === 'miss' ? styles.loss : undefined}>
              {VERDICT_LABEL[s.verdict]}
              {s.pct !== null && s.verdict !== 'inline' && ` ${signed(s.pct, 0)}`}
            </dd>
          </div>
        )}
        <div>
          <dt>Titolo dopo i risultati</dt>
          <dd className={row.reaction === null ? undefined : row.reaction >= 0 ? styles.gain : styles.loss}>{row.reaction === null ? '–' : signed(row.reaction)}</dd>
        </div>
      </dl>
    )
  }
  return (
    <dl className={local.metrics}>
      <div>
        <dt>EPS atteso</dt>
        <dd>{e.epsEstimate !== null ? e.epsEstimate.toFixed(2) : '–'}</dd>
      </div>
      <div>
        <dt>Ricavi attesi</dt>
        <dd>{e.revenueEstimate ? money(e.revenueEstimate) : '–'}</dd>
      </div>
      {row.tier === 'watch' && (
        <div>
          <dt>Movimento tipico</dt>
          <dd title="Media dei movimenti del titolo dopo le ultime 4 trimestrali, senza considerare il segno">{row.typical === null ? '–' : `±${row.typical.toFixed(1)}%`}</dd>
        </div>
      )}
    </dl>
  )
}

function RowItem({ row, reported }: { row: Row; reported: boolean }) {
  return (
    <li className={local.row} data-tier={row.tier}>
      <div className={local.who}>
        <Link href={`/stock/${encodeURIComponent(row.e.symbol)}`} className={table.symbol}>
          {row.e.symbol}
        </Link>
        {row.info?.name && <span className={local.name}>{row.info.name}</span>}
        {row.tier === 'watch' && <span className={table.badge}>in watchlist</span>}
        {row.tier !== 'minor' && row.info?.marketCap != null && <span className={local.cap}>cap. {money(row.info.marketCap)}</span>}
      </div>
      <Metrics row={row} reported={reported} />
    </li>
  )
}

function DaySection({ day, rows, today, reported }: { day: string; rows: Row[]; today: string; reported: boolean }) {
  return (
    <section id={`d-${day}`} className={local.day}>
      <h2 className={local.dayTitle}>
        {dayHeading(day, today)}
        <span className={local.dayCount}>{rows.length === 1 ? '1 azienda' : `${rows.length} aziende`}</span>
      </h2>
      <div className={local.slots}>
        {SLOTS.map((slot) => {
          const inSlot = rows.filter((r) => slotOf(r.e.hour) === slot.key)
          if (inSlot.length === 0) return null
          const main = inSlot.filter((r) => r.tier !== 'minor')
          const minor = inSlot.filter((r) => r.tier === 'minor')
          return (
            <div key={slot.key} className={local.slot}>
              <h3 className={local.slotTitle}>{slot.label}</h3>
              {main.length > 0 && (
                <ul className={local.list}>
                  {main.map((r) => (
                    <RowItem key={r.e.symbol} row={r} reported={reported} />
                  ))}
                </ul>
              )}
              {minor.length > 0 && (
                <details className={local.more} open={main.length === 0}>
                  <summary>{main.length > 0 ? `Altre ${minor.length} aziende` : minor.length === 1 ? '1 azienda' : `${minor.length} aziende`}</summary>
                  <ul className={local.list}>
                    {minor.map((r) => (
                      <RowItem key={r.e.symbol} row={r} reported={reported} />
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

async function EarningsCalendar({ searchParams }: { searchParams: Promise<Search> }) {
  await connection()
  const params = await searchParams
  const period: Period = PERIODS.find((p) => p.key === params.periodo)?.key ?? 'prossime'
  const reported = period === 'uscite'
  const days = DAYS.includes(Number(params.giorni)) ? Number(params.giorni) : 14
  const view = VIEWS.find((v) => v.key === params.vista)?.key ?? 'big'
  const query = (params.q ?? '').trim().slice(0, 40).toLowerCase()

  const today = tradingDay()
  const from = reported ? addDays(today, -REPORTED_DAYS) : today
  const to = reported ? today : addDays(today, days)

  const [watched, calendar] = await Promise.all([
    currentUserId().then((userId) =>
      prisma.stock.findMany({
        where: { watchers: { some: { userId } } },
        select: { symbol: true, name: true, nextEarningsDate: true, nextEarningsHour: true, nextEarningsEpsEstimate: true },
      })
    ),
    getEarningsFeed(from, to).then(
      (events) => ({ events, failed: false }),
      (err) => {
        console.error('Earnings calendar failed:', err instanceof Error ? err.message : err)
        return { events: [] as EarningsEvent[], failed: true }
      }
    ),
  ])
  const names = new Map(watched.map((s) => [s.symbol, s.name]))
  const watchedSymbols = new Set(names.keys())

  // A watched stock the US feed does not cover (Borsa Italiana...) still shows up, with the date saved when it was last refreshed.
  let events = calendar.events
  if (!reported) {
    const known = new Set(events.map((e) => e.symbol))
    const extra: EarningsEvent[] = watched
      .filter((s) => !known.has(s.symbol) && s.nextEarningsDate)
      .map((s) => ({ symbol: s.symbol, date: s.nextEarningsDate!.toISOString().slice(0, 10), hour: s.nextEarningsHour, epsEstimate: s.nextEarningsEpsEstimate, revenueEstimate: null, epsActual: null, revenueActual: null }))
      .filter((e) => e.date >= from && e.date <= to)
    events = [...events, ...extra]
  }
  if (reported) events = events.filter((e) => e.epsActual !== null)

  const lookup = view === 'watch' ? [] : events.filter((e) => !watchedSymbols.has(e.symbol) && (e.revenueEstimate ?? 0) >= MIN_REVENUE_FOR_LOOKUP).map((e) => e.symbol)
  const infos = await getQuoteInfo([...lookup, ...watchedSymbols]).catch(() => new Map<string, QuoteInfo>())

  const tiered = events
    .map((e) => {
      const info = infos.get(e.symbol)
      const name = names.get(e.symbol)
      return { e, tier: tierOf(e, watchedSymbols, info), info: info ? { ...info, name: name ?? info.name } : name ? { name, marketCap: null, changePct: null, time: null } : undefined }
    })
    .filter((r) => (view === 'watch' ? r.tier === 'watch' : view === 'big' ? r.tier !== 'minor' : true))
    .filter((r) => !query || r.e.symbol.toLowerCase().includes(query) || (r.info?.name ?? '').toLowerCase().includes(query))
    .sort((a, b) => compareEvents({ e: a.e, tier: a.tier, cap: a.info?.marketCap ?? null }, { e: b.e, tier: b.tier, cap: b.info?.marketCap ?? null }))

  const rows: Row[] = await Promise.all(
    tiered.map(async (r) => {
      const watch = r.tier === 'watch'
      const [typical, reaction] = await Promise.all([
        watch && !reported ? getTypicalMove(r.e.symbol, today).catch(() => null) : null,
        reported ? (watch ? reactionFromBars(r.e.symbol, r.e).catch(() => null) : quoteReaction(r.e, r.info)) : null,
      ])
      return { ...r, typical, reaction: reaction ?? (reported && watch ? quoteReaction(r.e, r.info) : null) }
    })
  )

  const byDay = new Map<string, Row[]>()
  for (const r of rows) byDay.set(r.e.date, [...(byDay.get(r.e.date) ?? []), r])
  const dayKeys = [...byDay.keys()].sort((a, b) => (reported ? b.localeCompare(a) : a.localeCompare(b)))

  const href = (over: Partial<{ periodo: string; giorni: number; vista: string }>) => {
    const q = new URLSearchParams({ periodo: period, giorni: String(days), vista: view })
    if (query) q.set('q', query)
    for (const [k, v] of Object.entries(over)) q.set(k, String(v))
    return `/trimestrali?${q.toString()}`
  }
  // Calendar apps cannot log in: the feed is protected by a token that only a signed-in visitor of this page gets to see.
  const calendarToken = process.env.CALENDAR_TOKEN
  const calendarHref = calendarToken ? `/api/calendar?token=${encodeURIComponent(calendarToken)}` : null

  return (
    <section className={styles.section}>
      <p className={styles.lead}>
        Trimestrali delle aziende USA e dei titoli che segui, anche fuori dagli USA. Le date sono quelle comunicate dalle aziende e possono cambiare.
      </p>
      <div className={table.filters}>
        <nav className={table.group} aria-label="Quali trimestrali">
          {PERIODS.map((p) => (
            <Link key={p.key} href={href({ periodo: p.key })} aria-current={p.key === period ? 'page' : undefined}>
              {p.label}
            </Link>
          ))}
        </nav>
        {!reported && (
          <nav className={table.group} aria-label="Periodo">
            {DAYS.map((d) => (
              <Link key={d} href={href({ giorni: d })} aria-current={d === days ? 'page' : undefined}>
                {d} giorni
              </Link>
            ))}
          </nav>
        )}
        <nav className={table.group} aria-label="Quali titoli">
          {VIEWS.map((v) => (
            <Link key={v.key} href={href({ vista: v.key })} aria-current={v.key === view ? 'page' : undefined}>
              {v.label}
            </Link>
          ))}
        </nav>
        <form className={local.search} action="/trimestrali" role="search">
          <input type="hidden" name="periodo" value={period} />
          <input type="hidden" name="giorni" value={days} />
          <input type="hidden" name="vista" value={view} />
          <input type="search" name="q" defaultValue={query} placeholder="Cerca titolo" aria-label="Cerca per simbolo o nome" />
          <button type="submit">Cerca</button>
        </form>
        {calendarHref && (
          <a className={local.cta} href={calendarHref}>
            Aggiungi al calendario
          </a>
        )}
      </div>
      <p className={local.hint}>
        {reported
          ? 'Risultati degli ultimi 7 giorni: utile per azione reale contro la stima degli analisti. La reazione è la variazione della prima seduta dopo i risultati; per i titoli fuori watchlist si vede solo se è l’ultima seduta.'
          : 'Grandi aziende: capitalizzazione di almeno 10 mld $. Il movimento tipico, per i titoli che segui, è la media di quanto si è mosso il titolo dopo le ultime 4 trimestrali.'}
        {calendarHref ? ' Il pulsante del calendario scarica un file .ics con le trimestrali della watchlist.' : ''}
      </p>
      {!reported && dayKeys.length > 0 && (
        <nav className={local.strip} aria-label="Giorni con trimestrali">
          {dayKeys.map((day) => {
            const list = byDay.get(day)!
            const watchCount = list.filter((r) => r.tier === 'watch').length
            return (
              <a key={day} href={`#d-${day}`} className={local.stripDay} data-today={day === today || undefined}>
                <span className={local.stripWeekday}>{utcDate(day).toLocaleDateString('it-IT', { weekday: 'short', timeZone: 'UTC' })}</span>
                <span className={local.stripNumber}>{utcDate(day).getUTCDate()}</span>
                <span className={local.stripCount}>{list.length}</span>
                {watchCount > 0 && (
                  <span className={local.stripDots} role="img" aria-label={`${watchCount} in watchlist`}>
                    {Array.from({ length: Math.min(watchCount, 4) }, (_, i) => (
                      <i key={i} />
                    ))}
                  </span>
                )}
              </a>
            )
          })}
        </nav>
      )}
      {calendar.failed && !reported ? (
        <p className={styles.empty}>Non riesco a scaricare il calendario in questo momento. Riprova tra qualche minuto.</p>
      ) : dayKeys.length === 0 ? (
        <p className={styles.empty}>
          {reported ? 'Nessun risultato negli ultimi 7 giorni con questo filtro. Prova «Tutte».' : 'Nessuna trimestrale in questo periodo con questo filtro. Prova ad allargare il periodo o a scegliere «Tutte».'}
        </p>
      ) : (
        dayKeys.map((day) => <DaySection key={day} day={day} rows={byDay.get(day)!} today={today} reported={reported} />)
      )}
    </section>
  )
}

export default function EarningsPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Calendario trimestrali</h1>
      <Suspense fallback={<SectionSkeleton label="Carico le trimestrali…" variant="list" />}>
        <AuthGate path="/trimestrali">
          <EarningsCalendar searchParams={searchParams} />
        </AuthGate>
      </Suspense>
    </main>
  )
}
