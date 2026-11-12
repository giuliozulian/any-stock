export const BIG_MOVE_THRESHOLD_PCT = 15

export interface MoverInput {
  symbol: string
  name: string
  changePct: number
}

export function bigMovers<T extends MoverInput>(items: T[], threshold: number = BIG_MOVE_THRESHOLD_PCT): T[] {
  return items
    .filter((i) => Math.abs(i.changePct) >= threshold)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
}

export interface MarketMover extends MoverInput {
  price: number
  marketCap: number | null
  volume: number | null
  exchange: string | null
}

const SCREENER_URL = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved'
const MIN_PRICE = 1

interface YahooQuote {
  symbol: string
  shortName?: string
  longName?: string
  regularMarketChangePercent?: number
  regularMarketPrice?: number
  marketCap?: number
  regularMarketVolume?: number
  fullExchangeName?: string
}

async function fetchScreener(scrId: 'day_gainers' | 'day_losers'): Promise<YahooQuote[]> {
  const res = await fetch(`${SCREENER_URL}?scrIds=${scrId}&count=100`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Yahoo screener failed: ${res.status} ${scrId}`)
  const data = (await res.json()) as { finance?: { result?: Array<{ quotes?: YahooQuote[] }> } }
  return data.finance?.result?.[0]?.quotes ?? []
}

export async function getMarketBigMovers(threshold: number = BIG_MOVE_THRESHOLD_PCT): Promise<MarketMover[]> {
  const [gainers, losers] = await Promise.all([fetchScreener('day_gainers'), fetchScreener('day_losers')])
  const seen = new Set<string>()
  const items: MarketMover[] = []
  for (const q of [...gainers, ...losers]) {
    if (seen.has(q.symbol)) continue
    seen.add(q.symbol)
    if (typeof q.regularMarketChangePercent !== 'number' || typeof q.regularMarketPrice !== 'number') continue
    if (q.regularMarketPrice < MIN_PRICE) continue
    items.push({
      symbol: q.symbol,
      name: q.shortName ?? q.longName ?? q.symbol,
      changePct: q.regularMarketChangePercent,
      price: q.regularMarketPrice,
      marketCap: q.marketCap ?? null,
      volume: q.regularMarketVolume ?? null,
      exchange: q.fullExchangeName ?? null,
    })
  }
  return bigMovers(items, threshold)
}
