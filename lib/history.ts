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
