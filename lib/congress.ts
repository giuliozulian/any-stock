export interface CongressTrade {
  member: string
  chamber: string
  state: string
  side: 'buy' | 'sell'
  amountLow: number
  amountHigh: number
  date: string
  disclosedAt: string
}

interface RawTrade {
  member?: string
  chamber?: string
  state?: string
  type?: string
  amount_low?: number
  amount_high?: number
  transaction_date?: string
  disclosure_date?: string
}

interface FmpTrade {
  firstName?: string
  lastName?: string
  district?: string
  type?: string
  amount?: string
  transactionDate?: string
  disclosureDate?: string
}

const money = (v: string) => Number(v.replace(/[^0-9.]/g, '')) || 0

// Financial Modeling Prep house-trades / senate-trades: full history by ticker, amounts as text ranges ("$15,001 - $50,000").
export function parseFmpTrades(json: unknown, chamber: 'house' | 'senate'): CongressTrade[] {
  if (!Array.isArray(json)) return []
  const trades: CongressTrade[] = []
  for (const t of json as FmpTrade[]) {
    const kind = (t.type ?? '').toLowerCase()
    const side = kind.startsWith('purchase') ? 'buy' : kind.startsWith('sale') ? 'sell' : null
    const member = `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim()
    if (!side || !member || !t.transactionDate) continue
    const [low, high] = (t.amount ?? '').split('-').map((x) => money(x))
    trades.push({ member, chamber, state: (t.district ?? '').slice(0, 2), side, amountLow: low ?? 0, amountHigh: high ?? low ?? 0, date: t.transactionDate, disclosedAt: t.disclosureDate ?? '' })
  }
  return trades
}

async function getFmpTrades(symbol: string, apiKey: string): Promise<CongressTrade[] | null> {
  const get = async (path: 'house-trades' | 'senate-trades', chamber: 'house' | 'senate') => {
    const res = await fetch(`https://financialmodelingprep.com/stable/${path}?symbol=${encodeURIComponent(symbol)}&limit=250&apikey=${apiKey}`, { signal: AbortSignal.timeout(8000) })
    return res.ok ? parseFmpTrades(await res.json(), chamber) : null
  }
  const [house, senate] = await Promise.all([get('house-trades', 'house').catch(() => null), get('senate-trades', 'senate').catch(() => null)])
  if (house === null && senate === null) return null
  return [...(house ?? []), ...(senate ?? [])].sort((a, b) => b.date.localeCompare(a.date))
}

const TTL_MS = 6 * 60 * 60 * 1000
const cache = new Map<string, { at: number; trades: CongressTrade[] }>()

// Buys and sells only (exchanges and other types are not a clear signal); the feed repeats identical rows, so they are deduplicated.
export function parseCongressTrades(json: unknown): CongressTrade[] {
  const raw = (json as { trades?: RawTrade[] } | null)?.trades
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const trades: CongressTrade[] = []
  for (const t of raw) {
    const side = t.type === 'purchase' ? 'buy' : t.type === 'sale' ? 'sell' : null
    if (!side || !t.member || !t.transaction_date) continue
    const key = `${t.member}|${t.transaction_date}|${side}|${t.amount_low}|${t.amount_high}`
    if (seen.has(key)) continue
    seen.add(key)
    trades.push({
      member: t.member,
      chamber: t.chamber ?? '',
      state: t.state ?? '',
      side,
      amountLow: t.amount_low ?? 0,
      amountHigh: t.amount_high ?? 0,
      date: t.transaction_date,
      disclosedAt: t.disclosure_date ?? '',
    })
  }
  return trades.sort((a, b) => b.date.localeCompare(a.date))
}

// With FMP_API_KEY: Financial Modeling Prep (full history). Otherwise the Bargo free API (STOCK Act filings, rolling ~3 months). Keyless access has a tiny daily budget: set BARGO_API_KEY for more.
// Returns null when the source is unavailable, so the page can say so instead of showing "no trades".
export async function getCongressTrades(symbol: string): Promise<CongressTrade[] | null> {
  const key = symbol.toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.trades

  try {
    if (process.env.FMP_API_KEY) {
      const full = await getFmpTrades(key, process.env.FMP_API_KEY)
      if (full) {
        cache.set(key, { at: Date.now(), trades: full })
        return full
      }
    }
    const headers: Record<string, string> = {}
    if (process.env.BARGO_API_KEY) headers['X-Api-Key'] = process.env.BARGO_API_KEY
    const res = await fetch(`https://www.bargo.ai/free-apis/congress/v1/trades?ticker=${encodeURIComponent(key)}&limit=100`, { headers, signal: AbortSignal.timeout(6000) })
    if (!res.ok) return hit?.trades ?? null
    const trades = parseCongressTrades(await res.json())
    cache.set(key, { at: Date.now(), trades })
    return trades
  } catch {
    return hit?.trades ?? null
  }
}

export interface CongressBuy extends CongressTrade {
  ticker: string
  asset: string
  perfPct: number | null
}

interface RawBuy extends RawTrade {
  ticker?: string
  asset?: string
  perf_pct?: number | null
}

// Latest purchases across all tickers, newest disclosure first; only rows with a ticker (stocks/ETFs), identical rows counted once.
export function parseCongressBuys(json: unknown): CongressBuy[] {
  const raw = (json as { trades?: RawBuy[] } | null)?.trades
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const buys: CongressBuy[] = []
  for (const t of raw) {
    if (t.type !== 'purchase' || !t.member || !t.ticker || !t.transaction_date) continue
    const key = `${t.member}|${t.ticker}|${t.transaction_date}|${t.amount_low}|${t.amount_high}`
    if (seen.has(key)) continue
    seen.add(key)
    buys.push({
      member: t.member,
      chamber: t.chamber ?? '',
      state: t.state ?? '',
      side: 'buy',
      amountLow: t.amount_low ?? 0,
      amountHigh: t.amount_high ?? 0,
      date: t.transaction_date,
      disclosedAt: t.disclosure_date ?? '',
      ticker: t.ticker,
      perfPct: typeof t.perf_pct === 'number' ? t.perf_pct : null,
      asset: (t.asset ?? t.ticker).replace(/\s*\([A-Z.\-]+\)\s*\[[A-Z]+\]\s*$/, ''),
    })
  }
  return buys.sort((a, b) => b.disclosedAt.localeCompare(a.disclosedAt) || b.date.localeCompare(a.date))
}

let recentBuys: { at: number; buys: CongressBuy[] } | null = null
const RECENT_TTL_MS = 30 * 60 * 1000

// Cached: the free API has a daily row budget, and the last good result is served if it is exhausted.
export async function getRecentCongressBuys(): Promise<CongressBuy[] | null> {
  if (recentBuys && Date.now() - recentBuys.at < RECENT_TTL_MS) return recentBuys.buys
  try {
    const headers: Record<string, string> = {}
    if (process.env.BARGO_API_KEY) headers['X-Api-Key'] = process.env.BARGO_API_KEY
    const res = await fetch('https://www.bargo.ai/free-apis/congress/v1/trades?type=purchase&limit=500', { headers, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return recentBuys?.buys ?? null
    const buys = parseCongressBuys(await res.json())
    recentBuys = { at: Date.now(), buys }
    return buys
  } catch {
    return recentBuys?.buys ?? null
  }
}

export interface BuyCluster {
  ticker: string
  asset: string
  members: string[]
  trades: number
  totalLow: number
  totalHigh: number
  lastDisclosedAt: string
  avgPerfPct: number | null
}

// Groups purchases by ticker: many different politicians buying the same stock is the most useful signal for finding new ideas.
export function clusterBuys(buys: CongressBuy[], minMembers = 2): BuyCluster[] {
  const by = new Map<string, { asset: string; members: Set<string>; trades: number; low: number; high: number; last: string; perfs: number[] }>()
  for (const b of buys) {
    const e = by.get(b.ticker) ?? { asset: b.asset, members: new Set<string>(), trades: 0, low: 0, high: 0, last: '', perfs: [] }
    e.members.add(b.member)
    e.trades++
    e.low += b.amountLow
    e.high += b.amountHigh
    if (b.disclosedAt > e.last) e.last = b.disclosedAt
    if (b.perfPct !== null) e.perfs.push(b.perfPct)
    by.set(b.ticker, e)
  }
  return [...by.entries()]
    .filter(([, e]) => e.members.size >= minMembers)
    .map(([ticker, e]) => ({
      ticker,
      asset: e.asset,
      members: [...e.members],
      trades: e.trades,
      totalLow: e.low,
      totalHigh: e.high,
      lastDisclosedAt: e.last,
      avgPerfPct: e.perfs.length ? e.perfs.reduce((a, b) => a + b, 0) / e.perfs.length : null,
    }))
    .sort((a, b) => b.members.length - a.members.length || b.totalHigh - a.totalHigh)
}
