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

export type Market = 'us' | 'it' | 'cn'

const MARKET_EXCHANGES: Record<Exclude<Market, 'us'>, string[]> = { it: ['MIL'], cn: ['SHH', 'SHZ'] }
const MIN_MARKET_CAP = 100_000_000
const SCREENER_POST_URL = 'https://query1.finance.yahoo.com/v1/finance/screener'

// The custom screener (needed for non-US exchanges) requires a session cookie and a crumb.
async function yahooCrumb(): Promise<{ cookie: string; crumb: string }> {
  const headers = { 'User-Agent': 'Mozilla/5.0' }
  const first = await fetch('https://fc.yahoo.com', { headers, redirect: 'manual' })
  const cookie = first.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const res = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { ...headers, Cookie: cookie } })
  const crumb = await res.text()
  if (!res.ok || !crumb) throw new Error(`Yahoo crumb failed: ${res.status}`)
  return { cookie, crumb }
}

async function fetchExchangeMovers(exchanges: string[], auth: { cookie: string; crumb: string }, sortType: 'DESC' | 'ASC'): Promise<YahooQuote[]> {
  const res = await fetch(`${SCREENER_POST_URL}?crumb=${encodeURIComponent(auth.crumb)}&lang=en-US&region=US`, {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json', Cookie: auth.cookie },
    body: JSON.stringify({
      size: 100,
      offset: 0,
      sortField: 'percentchange',
      sortType,
      quoteType: 'EQUITY',
      query: {
        operator: 'AND',
        operands: [
          { operator: 'OR', operands: exchanges.map((e) => ({ operator: 'EQ', operands: ['exchange', e] })) },
          { operator: 'GT', operands: ['intradaymarketcap', MIN_MARKET_CAP] },
        ],
      },
      userId: '',
      userIdType: 'guid',
    }),
  })
  if (!res.ok) throw new Error(`Yahoo screener failed: ${res.status} ${exchanges.join(',')}`)
  const data = (await res.json()) as { finance?: { result?: Array<{ quotes?: YahooQuote[] }> | null } }
  return data.finance?.result?.[0]?.quotes ?? []
}

export async function getMarketBigMovers(threshold: number = BIG_MOVE_THRESHOLD_PCT, market: Market = 'us'): Promise<MarketMover[]> {
  let gainers: YahooQuote[]
  let losers: YahooQuote[]
  if (market === 'us') {
    ;[gainers, losers] = await Promise.all([fetchScreener('day_gainers'), fetchScreener('day_losers')])
  } else {
    const auth = await yahooCrumb()
    ;[gainers, losers] = await Promise.all([fetchExchangeMovers(MARKET_EXCHANGES[market], auth, 'DESC'), fetchExchangeMovers(MARKET_EXCHANGES[market], auth, 'ASC')])
  }
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
