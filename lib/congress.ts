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

// Bargo free API (STOCK Act filings, rolling ~3 months). Keyless access has a tiny daily budget: set BARGO_API_KEY for more.
// Returns null when the source is unavailable, so the page can say so instead of showing "no trades".
export async function getCongressTrades(symbol: string): Promise<CongressTrade[] | null> {
  const key = symbol.toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.trades

  try {
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
