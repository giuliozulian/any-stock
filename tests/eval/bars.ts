import type { Bar } from '@/lib/history'

// Daily bars between two dates straight from Yahoo; null on any failure.
export async function barsBetween(symbol: string, from: Date, to: Date): Promise<Bar[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(from.getTime() / 1000)}&period2=${Math.floor(to.getTime() / 1000)}&interval=1d`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res?.ok) return null
  const json = await res.json().catch(() => null)
  const r = json?.chart?.result?.[0]
  const q = r?.indicators?.quote?.[0]
  if (!r?.timestamp || !q) return null
  const bars: Bar[] = []
  r.timestamp.forEach((t: number, i: number) => {
    if (q.close[i] == null || q.high[i] == null || q.low[i] == null || q.volume[i] == null) return
    bars.push({ t: t * 1000, high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] })
  })
  return bars
}
