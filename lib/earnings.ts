import { getEarningsCalendar, getEarningsHistory, getReportedEarnings, type EarningsEvent, type EarningsHistoryRow } from './finnhub'
import { getDailyBars, type Bar } from './history'
import type { QuoteInfo } from './quote-info'
import { sharedCache } from './shared-cache'

export type Tier = 'watch' | 'big' | 'minor'
export type Slot = 'bmo' | 'dmh' | 'amc' | 'unknown'

export const BIG_MARKET_CAP = 10_000_000_000
// Used only when Yahoo gave no market cap for a symbol.
export const BIG_REVENUE = 1_000_000_000
const IN_LINE_PCT = 1
const TYPICAL_MOVE_REPORTS = 4
const NY = 'America/New_York'

const dayOf = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t))

export function slotOf(hour: string | null): Slot {
  return hour === 'bmo' || hour === 'dmh' || hour === 'amc' ? hour : 'unknown'
}

export function tierOf(e: Pick<EarningsEvent, 'symbol' | 'revenueEstimate'>, watched: Set<string>, info: QuoteInfo | undefined): Tier {
  if (watched.has(e.symbol)) return 'watch'
  if (info?.marketCap != null) return info.marketCap >= BIG_MARKET_CAP ? 'big' : 'minor'
  return (e.revenueEstimate ?? 0) >= BIG_REVENUE ? 'big' : 'minor'
}

const TIER_ORDER: Record<Tier, number> = { watch: 0, big: 1, minor: 2 }

// Watchlist first, then by market cap (or expected revenue when the cap is unknown), then by symbol.
export function compareEvents(a: { e: EarningsEvent; tier: Tier; cap: number | null }, b: { e: EarningsEvent; tier: Tier; cap: number | null }): number {
  return (
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
    (b.cap ?? b.e.revenueEstimate ?? 0) - (a.cap ?? a.e.revenueEstimate ?? 0) ||
    a.e.symbol.localeCompare(b.e.symbol)
  )
}

export type Verdict = 'beat' | 'miss' | 'inline'

export function surprise(actual: number | null, estimate: number | null): { pct: number | null; verdict: Verdict } | null {
  if (actual === null || estimate === null) return null
  const pct = estimate !== 0 ? ((actual - estimate) / Math.abs(estimate)) * 100 : null
  if (pct === null) return { pct, verdict: actual > 0 ? 'beat' : actual < 0 ? 'miss' : 'inline' }
  return { pct, verdict: Math.abs(pct) < IN_LINE_PCT ? 'inline' : pct > 0 ? 'beat' : 'miss' }
}

// Move of the first session that could react to the report: reports before or during the open react the same day, those after the close the next day.
export function reactionPct(bars: Bar[], date: string, hour: string | null): number | null {
  const i = bars.findIndex((b) => dayOf(b.t) === date)
  if (i < 0) return null
  const [base, target] = hour === 'amc' ? [bars[i], bars[i + 1]] : [bars[i - 1], bars[i]]
  if (!base || !target || base.close <= 0) return null
  return ((target.close - base.close) / base.close) * 100
}

// Next weekday after a date (holidays are not known here, so the match against the quote's own date guards the result).
function nextWeekday(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  do d.setUTCDate(d.getUTCDate() + 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

// Reaction read from today's quote: valid only when the quote is from the session that followed the report.
export function quoteReaction(e: Pick<EarningsEvent, 'date' | 'hour'>, info: QuoteInfo | undefined): number | null {
  if (!info || info.changePct === null || info.time === null) return null
  const reactionDay = e.hour === 'amc' ? nextWeekday(e.date) : e.date
  return dayOf(info.time) === reactionDay ? info.changePct : null
}

// Average size of the moves after the latest reports, ignoring direction. Null with fewer than two data points.
export function typicalMove(reactions: Array<number | null>): number | null {
  const sizes = reactions.filter((r): r is number => r !== null).slice(0, TYPICAL_MOVE_REPORTS).map(Math.abs)
  if (sizes.length < 2) return null
  return sizes.reduce((a, b) => a + b, 0) / sizes.length
}

const feedCache = sharedCache<{ at: number; events: EarningsEvent[] }>('earnings-feed')
const moveCache = sharedCache<{ at: number; move: number | null }>('earnings-move')
const FEED_TTL_MS = 30 * 60 * 1000
const MOVE_TTL_MS = 12 * 60 * 60 * 1000

export async function getEarningsFeed(from: string, to: string): Promise<EarningsEvent[]> {
  const key = `${from}:${to}`
  const hit = await feedCache.get(key, FEED_TTL_MS)
  if (hit && Date.now() - hit.at < FEED_TTL_MS) return hit.events
  try {
    const events = await getEarningsCalendar(from, to)
    await feedCache.set(key, { at: Date.now(), events })
    return events
  } catch (err) {
    if (hit) return hit.events
    throw err
  }
}

export async function reactionFromBars(symbol: string, e: Pick<EarningsEvent, 'date' | 'hour'>): Promise<number | null> {
  return reactionPct(await getDailyBars(symbol), e.date, e.hour)
}

// Typical move after earnings for one symbol, from its own last reports and daily prices. Cached for half a day.
export async function getTypicalMove(symbol: string, today: string): Promise<number | null> {
  const hit = await moveCache.get(symbol, MOVE_TTL_MS)
  if (hit && Date.now() - hit.at < MOVE_TTL_MS) return hit.move
  try {
    const from = new Date(Date.parse(`${today}T12:00:00Z`) - 540 * 86_400_000).toISOString().slice(0, 10)
    const [past, bars] = await Promise.all([getReportedEarnings(symbol, from, today), getDailyBars(symbol)])
    const reactions = past.filter((p) => p.date < today && p.epsActual !== null).map((p) => reactionPct(bars, p.date, p.hour))
    const move = typicalMove(reactions)
    await moveCache.set(symbol, { at: Date.now(), move })
    return move
  } catch {
    return hit?.move ?? null
  }
}

const HISTORY_TTL_MS = 6 * 60 * 60 * 1000
const historyCache = sharedCache<{ at: number; rows: EarningsHistoryRow[] }>('earnings-history')

// Three years of reports plus the next two quarters, newest first. Null when the provider fails and nothing is cached.
export async function getEarningsTable(symbol: string, today: string): Promise<EarningsHistoryRow[] | null> {
  const key = symbol.toUpperCase()
  const hit = await historyCache.get(key, HISTORY_TTL_MS)
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.rows
  try {
    const day = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
    const rows = await getEarningsHistory(key, day(-3 * 365), day(200))
    await historyCache.set(key, { at: Date.now(), rows })
    return rows
  } catch {
    return hit?.rows ?? null
  }
}
