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

export interface FullHistory {
  points: PricePoint[]
  // Points before this timestamp are sparser than daily (Yahoo thins out old data); null when the whole series is daily.
  sparseBefore: number | null
}

const FULL_TTL_MS = 6 * 60 * 60 * 1000
const DAY_MS = 86_400_000
const fullCache = new Map<string, { at: number; data: FullHistory }>()
const EMPTY_FULL: FullHistory = { points: [], sparseBefore: null }

// Split-adjusted closes from a Yahoo chart payload, oldest first. Rows without a positive close are dropped.
export function parseChartCloses(json: unknown): PricePoint[] {
  const result = (json as { chart?: { result?: Array<{ timestamp?: unknown; indicators?: { quote?: Array<{ close?: unknown }> } }> | null } } | null)?.chart?.result?.[0]
  const stamps = result?.timestamp
  const closes = result?.indicators?.quote?.[0]?.close
  if (!Array.isArray(stamps) || !Array.isArray(closes)) return []
  const points: PricePoint[] = []
  stamps.forEach((t, i) => {
    const close = closes[i]
    if (typeof t === 'number' && typeof close === 'number' && Number.isFinite(close) && close > 0) points.push({ t: t * 1000, close })
  })
  return points.sort((a, b) => a.t - b.t)
}

// Daily data averages under 1.5 calendar days between points; weekly is 7, monthly about 30.
function isSparse(points: PricePoint[]): boolean {
  if (points.length < 2) return false
  return (points[points.length - 1].t - points[0].t) / (points.length - 1) > 3 * DAY_MS
}

export function mergeHistories(sparse: PricePoint[], dense: PricePoint[]): FullHistory {
  if (dense.length === 0) return { points: sparse, sparseBefore: sparse.length > 0 ? sparse[sparse.length - 1].t : null }
  const older = sparse.filter((p) => p.t < dense[0].t)
  return { points: [...older, ...dense], sparseBefore: older.length > 0 ? dense[0].t : null }
}

async function fetchChart(key: string, query: string): Promise<PricePoint[] | null> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?${query}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null
  return parseChartCloses(await res.json())
}

// Whole listing history, for long-range performance. Returns the stale series (or an empty one) when Yahoo fails.
export async function getFullPriceHistory(symbol: string): Promise<FullHistory> {
  const key = symbol.toUpperCase()
  const hit = fullCache.get(key)
  if (hit && Date.now() - hit.at < FULL_TTL_MS) return hit.data

  try {
    const all = await fetchChart(key, `period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d`)
    if (!all || all.length === 0) return hit?.data ?? EMPTY_FULL
    if (!isSparse(all)) {
      const data: FullHistory = { points: all, sparseBefore: null }
      fullCache.set(key, { at: Date.now(), data })
      return data
    }
    const recent = await fetchChart(key, 'range=10y&interval=1d').catch(() => null)
    if (!recent || recent.length === 0 || isSparse(recent)) return hit?.data ?? mergeHistories(all, [])
    const data = mergeHistories(all, recent)
    fullCache.set(key, { at: Date.now(), data })
    return data
  } catch {
    return hit?.data ?? EMPTY_FULL
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
