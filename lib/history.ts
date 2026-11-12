export interface PricePoint {
  t: number
  close: number
}

const TTL_MS = 15 * 60 * 1000
const cache = new Map<string, { at: number; points: PricePoint[] }>()

export async function getPriceHistory(symbol: string): Promise<PricePoint[]> {
  const key = symbol.toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.points

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=1y&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) }
    )
    if (!res.ok) return hit?.points ?? []
    const json = (await res.json()) as {
      chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> }
    }
    const result = json.chart?.result?.[0]
    const closes = result?.indicators?.quote?.[0]?.close ?? []
    const points: PricePoint[] = []
    ;(result?.timestamp ?? []).forEach((t, i) => {
      const close = closes[i]
      if (typeof close === 'number' && Number.isFinite(close)) points.push({ t: t * 1000, close })
    })
    if (points.length > 0) cache.set(key, { at: Date.now(), points })
    return points
  } catch {
    return hit?.points ?? []
  }
}

export interface IntradayPoint extends PricePoint {
  session: 'pre' | 'regular' | 'post'
}

const INTRADAY_TTL_MS = 60 * 1000
export interface Intraday {
  points: IntradayPoint[]
  prevClose: number | null
}

const intradayCache = new Map<string, { at: number; data: Intraday }>()
const EMPTY: Intraday = { points: [], prevClose: null }

export async function getIntradayHistory(symbol: string): Promise<Intraday> {
  const key = symbol.toUpperCase()
  const hit = intradayCache.get(key)
  if (hit && Date.now() - hit.at < INTRADAY_TTL_MS) return hit.data

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=1d&interval=5m&includePrePost=true`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) }
    )
    if (!res.ok) return hit?.data ?? EMPTY
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: { chartPreviousClose?: number; currentTradingPeriod?: { regular?: { start: number; end: number } } }
          timestamp?: number[]
          indicators?: { quote?: Array<{ close?: Array<number | null> }> }
        }>
      }
    }
    const result = json.chart?.result?.[0]
    const closes = result?.indicators?.quote?.[0]?.close ?? []
    const reg = result?.meta?.currentTradingPeriod?.regular
    const points: IntradayPoint[] = []
    ;(result?.timestamp ?? []).forEach((t, i) => {
      const close = closes[i]
      if (typeof close !== 'number' || !Number.isFinite(close)) return
      const session = reg ? (t < reg.start ? 'pre' : t >= reg.end ? 'post' : 'regular') : 'regular'
      points.push({ t: t * 1000, close, session })
    })
    const prev = result?.meta?.chartPreviousClose
    const data: Intraday = { points, prevClose: typeof prev === 'number' ? prev : null }
    if (points.length > 0) intradayCache.set(key, { at: Date.now(), data })
    return data
  } catch {
    return hit?.data ?? EMPTY
  }
}
