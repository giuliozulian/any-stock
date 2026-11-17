import { sharedCache } from '@/lib/shared-cache'

export interface DividendPayment {
  t: number
  amount: number
}

export interface DividendHistory {
  payments: DividendPayment[]
  currency: string | null
}

const TTL_MS = 6 * 60 * 60 * 1000
const cache = sharedCache<{ at: number; data: DividendHistory }>('dividends')

// Dividend payments from a Yahoo chart payload, oldest first. Null when the payload is not a chart; a chart without `events.dividends` means the stock pays nothing.
export function parseDividends(json: unknown): DividendHistory | null {
  const result = (json as { chart?: { result?: Array<{ meta?: { currency?: unknown }; events?: { dividends?: unknown } }> | null } } | null)?.chart?.result?.[0]
  if (!result) return null
  const currency = typeof result.meta?.currency === 'string' && result.meta.currency.length > 0 ? result.meta.currency : null
  const raw = result.events?.dividends
  const rows = raw && typeof raw === 'object' ? Object.values(raw as Record<string, { amount?: unknown; date?: unknown }>) : []
  const byTime = new Map<number, number>()
  for (const entry of rows) {
    if (typeof entry?.date !== 'number' || !Number.isFinite(entry.date)) continue
    if (typeof entry.amount !== 'number' || !Number.isFinite(entry.amount) || entry.amount <= 0) continue
    byTime.set(entry.date * 1000, entry.amount)
  }
  const payments = [...byTime].map(([t, amount]) => ({ t, amount })).sort((a, b) => a.t - b.t)
  return { payments, currency }
}

// Whole dividend history of a listing. Returns the stale copy (or null) when Yahoo fails; never throws.
export async function getDividendHistory(symbol: string): Promise<DividendHistory | null> {
  const key = symbol.toUpperCase()
  const hit = await cache.get(key, TTL_MS)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data

  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=max&interval=1mo&events=div`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return hit?.data ?? null
    const data = parseDividends(await res.json())
    if (!data) return hit?.data ?? null
    await cache.set(key, { at: Date.now(), data })
    return data
  } catch {
    return hit?.data ?? null
  }
}

const DAY_MS = 86_400_000
// A year counts as a cut when it pays less than this share of the year before; it keeps small rounding or exchange-rate wobble out.
const CUT_RATIO = 0.95
// Without a regular rhythm there is no interval to scale, so a payment older than this means the dividend stopped.
const IRREGULAR_STALE_DAYS = 400
const PAYMENTS_PER_YEAR = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 } as const

export type DividendFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'irregular'

export interface DividendYear {
  year: number
  total: number
  count: number
  partial: boolean
}

export interface DividendGrowthStats {
  completeYears: number
  firstCompleteYear: number | null
  consecutiveIncreases: number
  cagr5Pct: number | null
  cagr10Pct: number | null
  cutYears: number[]
}

export interface DividendSummary {
  lastPayment: DividendPayment
  years: DividendYear[]
  ttmTotal: number
  yieldPct: number | null
  frequency: DividendFrequency | null
  suspended: boolean
  growth: DividendGrowthStats
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function frequencyOf(perYear: number): DividendFrequency {
  if (perYear >= 10) return 'monthly'
  if (perYear >= 3 && perYear <= 5) return 'quarterly'
  if (perYear === 2) return 'semiannual'
  if (perYear === 1) return 'annual'
  return 'irregular'
}

// Compound yearly growth between the last complete year and the one `span` years earlier.
function cagrPct(complete: DividendYear[], span: number): number | null {
  if (complete.length < span + 1) return null
  const last = complete[complete.length - 1].total
  const base = complete[complete.length - 1 - span].total
  if (last <= 0 || base <= 0) return null
  return ((last / base) ** (1 / span) - 1) * 100
}

function growthOf(complete: DividendYear[]): DividendGrowthStats {
  let consecutiveIncreases = 0
  for (let i = complete.length - 1; i >= 1; i--) {
    if (complete[i].total > complete[i - 1].total) consecutiveIncreases++
    else break
  }
  const cutYears: number[] = []
  for (let i = 1; i < complete.length; i++) {
    if (complete[i].total < complete[i - 1].total * CUT_RATIO) cutYears.push(complete[i].year)
  }
  return {
    completeYears: complete.length,
    firstCompleteYear: complete[0]?.year ?? null,
    consecutiveIncreases,
    cagr5Pct: cagrPct(complete, 5),
    cagr10Pct: cagrPct(complete, 10),
    cutYears,
  }
}

// Yearly totals, rhythm, trailing yield and growth of a dividend history (oldest payment first). Payments dated after `now` are ignored; null when none remain.
export function dividendSummary(payments: DividendPayment[], now: Date, price: number | null): DividendSummary | null {
  const paid = payments.filter((p) => p.t <= now.getTime())
  if (paid.length === 0) return null

  const firstYear = new Date(paid[0].t).getUTCFullYear()
  const currentYear = now.getUTCFullYear()
  const years: DividendYear[] = []
  for (let year = firstYear; year <= currentYear; year++) {
    const own = paid.filter((p) => new Date(p.t).getUTCFullYear() === year)
    years.push({ year, total: round6(own.reduce((sum, p) => sum + p.amount, 0)), count: own.length, partial: year === firstYear || year === currentYear })
  }
  const complete = years.filter((y) => !y.partial)

  const lastPayment = paid[paid.length - 1]
  const ttmTotal = round6(paid.filter((p) => p.t > now.getTime() - 365 * DAY_MS).reduce((sum, p) => sum + p.amount, 0))
  const yieldPct = price !== null && price > 0 ? (ttmTotal / price) * 100 : null

  const recent = complete.slice(-3)
  const frequency = recent.length > 0 ? frequencyOf(median(recent.map((y) => y.count))) : null
  const staleAfterDays = frequency && frequency !== 'irregular' ? 1.5 * (365 / PAYMENTS_PER_YEAR[frequency]) : IRREGULAR_STALE_DAYS
  const suspended = (now.getTime() - lastPayment.t) / DAY_MS > staleAfterDays

  return { lastPayment, years, ttmTotal, yieldPct, frequency, suspended, growth: growthOf(complete) }
}
