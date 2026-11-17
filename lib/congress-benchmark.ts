import type { CongressBuy } from './congress'
import { getDailyBars, type Bar } from './history'

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10)

// Return of an index from the first session on or after `date` to the latest close. Null when the date is outside the bars we have.
export function marketReturnSince(bars: Bar[], date: string): number | null {
  const first = bars.findIndex((b) => dayOf(b.t) >= date)
  const last = bars[bars.length - 1]
  if (first < 0 || !last || bars[first].close <= 0) return null
  // A date before the first bar means the series does not reach back far enough.
  if (first === 0 && dayOf(bars[0].t) > date) return null
  return ((last.close - bars[first].close) / bars[first].close) * 100
}

// A stock that is up 8% is not a good pick when the market is up 10%: attach the S&P 500 return over the same days to every purchase.
export async function withMarketReturn(buys: CongressBuy[]): Promise<CongressBuy[]> {
  const bars = await getDailyBars('SPY').catch(() => [] as Bar[])
  if (bars.length === 0) return buys
  return buys.map((b) => ({ ...b, marketPct: marketReturnSince(bars, b.date) }))
}
