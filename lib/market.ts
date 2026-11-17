import { sharedCache } from './shared-cache'

export const BIG_MOVE_THRESHOLD_PCT = 5

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
  // Today's volume over the 3-month average daily volume: a big move on thin volume is mostly noise.
  relVolume: number | null
  exchange: string | null
}

export type Market = 'us' | 'it' | 'cn'

export interface MarketSnapshot {
  movers: MarketMover[]
  // Time of the latest quote, in ms, and Yahoo's state of the exchange (REGULAR, PRE, POST, CLOSED...).
  asOf: number | null
  marketState: string | null
  fetchedAt: number
}

interface YahooQuote {
  symbol: string
  shortName?: string
  longName?: string
  regularMarketChangePercent?: number
  regularMarketPrice?: number
  regularMarketTime?: number
  marketCap?: number
  regularMarketVolume?: number
  averageDailyVolume3Month?: number
  fullExchangeName?: string
  marketState?: string
}

const MIN_PRICE = 1
const MARKET_EXCHANGES: Record<Market, string[]> = {
  us: ['NMS', 'NGM', 'NCM', 'NYQ', 'ASE'],
  it: ['MIL'],
  cn: ['SHH', 'SHZ'],
}
// Explicit floors, equal in every market: Yahoo's predefined US lists silently use a ~2 bn cap and a $5 price instead.
export const MIN_MARKET_CAP: Record<Market, number> = { us: 300_000_000, it: 100_000_000, cn: 100_000_000 }
const MIN_DAY_VOLUME = 50_000
const SCREENER_SIZE = 100
const SCREENER_POST_URL = 'https://query1.finance.yahoo.com/v1/finance/screener'
const CACHE_TTL_MS = 90_000
const CRUMB_TTL_MS = 60 * 60 * 1000
const NOT_COMMON_STOCK = /\b(warrants?|rights?|units?|notes?|preferred|depositary)\b/i

// Warrants, rights and similar instruments pass the EQUITY filter but are not companies whose move can be explained.
export function isCommonStock(q: Pick<YahooQuote, 'symbol' | 'shortName' | 'longName'>): boolean {
  return !NOT_COMMON_STOCK.test(`${q.shortName ?? ''} ${q.longName ?? ''}`)
}

export function relativeVolume(volume: number | undefined, average: number | undefined): number | null {
  if (!volume || !average || average <= 0) return null
  return volume / average
}

let crumbCache: { at: number; auth: Promise<{ cookie: string; crumb: string }> } | null = null

async function requestCrumb(): Promise<{ cookie: string; crumb: string }> {
  const headers = { 'User-Agent': 'Mozilla/5.0' }
  const first = await fetch('https://fc.yahoo.com', { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) })
  const cookie = first.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const res = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { ...headers, Cookie: cookie }, signal: AbortSignal.timeout(8000) })
  const crumb = await res.text()
  if (!res.ok || !crumb) throw new Error(`Yahoo crumb failed: ${res.status}`)
  return { cookie, crumb }
}

// The custom screener requires a session cookie and a crumb. One pair is reused for an hour, and concurrent callers share the same request.
function yahooCrumb(force = false): Promise<{ cookie: string; crumb: string }> {
  if (!force && crumbCache && Date.now() - crumbCache.at < CRUMB_TTL_MS) return crumbCache.auth
  const auth = requestCrumb()
  crumbCache = { at: Date.now(), auth }
  auth.catch(() => {
    if (crumbCache?.auth === auth) crumbCache = null
  })
  return auth
}

async function fetchExchangeMovers(market: Market, sortType: 'DESC' | 'ASC', auth: { cookie: string; crumb: string }): Promise<Response> {
  return fetch(`${SCREENER_POST_URL}?crumb=${encodeURIComponent(auth.crumb)}&lang=en-US&region=US`, {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json', Cookie: auth.cookie },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      size: SCREENER_SIZE,
      offset: 0,
      sortField: 'percentchange',
      sortType,
      quoteType: 'EQUITY',
      query: {
        operator: 'AND',
        operands: [
          { operator: 'OR', operands: MARKET_EXCHANGES[market].map((e) => ({ operator: 'EQ', operands: ['exchange', e] })) },
          { operator: 'GT', operands: ['intradaymarketcap', MIN_MARKET_CAP[market]] },
          { operator: 'GT', operands: ['intradayprice', MIN_PRICE] },
          { operator: 'GT', operands: ['dayvolume', MIN_DAY_VOLUME] },
        ],
      },
      userId: '',
      userIdType: 'guid',
    }),
  })
}

async function fetchQuotes(market: Market, sortType: 'DESC' | 'ASC'): Promise<YahooQuote[]> {
  let res = await fetchExchangeMovers(market, sortType, await yahooCrumb())
  // An expired crumb answers 401: fetch a new one once.
  if (res.status === 401 || res.status === 403) res = await fetchExchangeMovers(market, sortType, await yahooCrumb(true))
  if (!res.ok) throw new Error(`Yahoo screener failed: ${res.status} ${market}`)
  const data = (await res.json()) as { finance?: { result?: Array<{ quotes?: YahooQuote[] }> | null } }
  return data.finance?.result?.[0]?.quotes ?? []
}

export function buildSnapshot(quotes: YahooQuote[], fetchedAt: number = Date.now()): MarketSnapshot {
  const seen = new Set<string>()
  const movers: MarketMover[] = []
  let latest = 0
  let state: string | null = null
  for (const q of quotes) {
    if (seen.has(q.symbol)) continue
    seen.add(q.symbol)
    if (typeof q.regularMarketChangePercent !== 'number' || typeof q.regularMarketPrice !== 'number') continue
    if (q.regularMarketPrice < MIN_PRICE || !isCommonStock(q)) continue
    if (q.regularMarketTime && q.regularMarketTime > latest) latest = q.regularMarketTime
    state ??= q.marketState ?? null
    movers.push({
      symbol: q.symbol,
      name: q.shortName ?? q.longName ?? q.symbol,
      changePct: q.regularMarketChangePercent,
      price: q.regularMarketPrice,
      marketCap: q.marketCap ?? null,
      volume: q.regularMarketVolume ?? null,
      relVolume: relativeVolume(q.regularMarketVolume, q.averageDailyVolume3Month),
      exchange: q.fullExchangeName ?? null,
    })
  }
  return { movers: bigMovers(movers, 0), asOf: latest ? latest * 1000 : null, marketState: state, fetchedAt }
}

const cache = sharedCache<MarketSnapshot & { at: number }>('market-movers')

// All movers of a market, cached for a minute and a half so every visitor shares one set of Yahoo calls. A failed refresh falls back to the last copy.
export async function getMarketSnapshot(market: Market = 'us'): Promise<MarketSnapshot> {
  const hit = await cache.get(market, CACHE_TTL_MS)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit
  try {
    const [gainers, losers] = await Promise.all([fetchQuotes(market, 'DESC'), fetchQuotes(market, 'ASC')])
    const snapshot = { ...buildSnapshot([...gainers, ...losers]), at: Date.now() }
    await cache.set(market, snapshot)
    return snapshot
  } catch (err) {
    if (hit) return hit
    throw err
  }
}

export async function getMarketBigMovers(threshold: number = BIG_MOVE_THRESHOLD_PCT, market: Market = 'us'): Promise<MarketMover[]> {
  return bigMovers((await getMarketSnapshot(market)).movers, threshold)
}

const OPEN_STATES = new Set(['REGULAR'])

export function isMarketLive(state: string | null): boolean {
  return state !== null && OPEN_STATES.has(state)
}
