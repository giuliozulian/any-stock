export interface DividendPayment {
  t: number
  amount: number
}

export interface DividendHistory {
  payments: DividendPayment[]
  currency: string | null
}

const TTL_MS = 6 * 60 * 60 * 1000
const cache = new Map<string, { at: number; data: DividendHistory }>()

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
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data

  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=max&interval=1mo&events=div`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return hit?.data ?? null
    const data = parseDividends(await res.json())
    if (!data) return hit?.data ?? null
    cache.set(key, { at: Date.now(), data })
    return data
  } catch {
    return hit?.data ?? null
  }
}
