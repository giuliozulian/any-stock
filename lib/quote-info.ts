import { yahooCrumb } from './market'

export interface QuoteInfo {
  name: string
  marketCap: number | null
  changePct: number | null
  // Time of the latest regular-session quote, in ms.
  time: number | null
}

const CHUNK = 150
const TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; info: QuoteInfo }>()

interface RawQuote {
  symbol: string
  shortName?: string
  longName?: string
  marketCap?: number
  regularMarketChangePercent?: number
  regularMarketTime?: number
}

async function fetchChunk(symbols: string[]): Promise<RawQuote[]> {
  const call = async (force: boolean) => {
    const auth = await yahooCrumb(force)
    return fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}&crumb=${encodeURIComponent(auth.crumb)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Cookie: auth.cookie },
      signal: AbortSignal.timeout(10_000),
    })
  }
  let res = await call(false)
  if (res.status === 401 || res.status === 403) res = await call(true)
  if (!res.ok) throw new Error(`Yahoo quote failed: ${res.status}`)
  const data = (await res.json()) as { quoteResponse?: { result?: RawQuote[] | null } }
  return data.quoteResponse?.result ?? []
}

// Name, market cap and last session change for many symbols in a few requests. A failing chunk is skipped: callers treat missing symbols as unknown.
export async function getQuoteInfo(symbols: string[]): Promise<Map<string, QuoteInfo>> {
  const out = new Map<string, QuoteInfo>()
  const missing: string[] = []
  for (const symbol of new Set(symbols)) {
    const hit = cache.get(symbol)
    if (hit && Date.now() - hit.at < TTL_MS) out.set(symbol, hit.info)
    else missing.push(symbol)
  }
  const chunks: string[][] = []
  for (let i = 0; i < missing.length; i += CHUNK) chunks.push(missing.slice(i, i + CHUNK))
  const results = await Promise.all(
    chunks.map((c) =>
      fetchChunk(c).catch((err) => {
        console.error('Quote info failed:', err instanceof Error ? err.message : err)
        return [] as RawQuote[]
      })
    )
  )
  for (const q of results.flat()) {
    const info: QuoteInfo = {
      name: q.shortName ?? q.longName ?? q.symbol,
      marketCap: q.marketCap ?? null,
      changePct: q.regularMarketChangePercent ?? null,
      time: q.regularMarketTime ? q.regularMarketTime * 1000 : null,
    }
    cache.set(q.symbol, { at: Date.now(), info })
    out.set(q.symbol, info)
  }
  return out
}
