import type { InsiderTransaction } from './finnhub'

export type InsiderSide = 'buy' | 'sell'

export interface InsiderTrade {
  name: string
  side: InsiderSide
  shares: number
  price: number
  value: number
  date: string
  filingDate: string
  accession?: string
  role?: string | null
}

export interface InsiderSummary {
  buys: number
  sells: number
  netShares: number
  buyValue: number
  sellValue: number
  mood: 'buying' | 'selling' | 'neutral'
}

// Only open-market purchases (P) and sales (S): grants, gifts, option exercises and tax withholdings say nothing about conviction.
// By default tranches filed by the same person, same day and same side are merged into one operation (weighted average price); group=false keeps every row.
export function toTrades(transactions: InsiderTransaction[], sinceDate: string, group = true): InsiderTrade[] {
  const groups = new Map<string, InsiderTrade>()
  for (const t of transactions) {
    if ((t.code !== 'P' && t.code !== 'S') || t.change === 0 || t.transactionDate < sinceDate) continue
    const side: InsiderSide = t.code === 'P' ? 'buy' : 'sell'
    const shares = Math.abs(t.change)
    const key = group ? `${t.name}|${t.transactionDate}|${side}` : `${t.id ?? ''}|${groups.size}`
    const prev = groups.get(key)
    const value = shares * t.price + (prev?.value ?? 0)
    const totalShares = shares + (prev?.shares ?? 0)
    groups.set(key, {
      name: t.name,
      side,
      shares: totalShares,
      price: totalShares > 0 ? value / totalShares : 0,
      value,
      date: t.transactionDate,
      filingDate: prev && prev.filingDate > t.filingDate ? prev.filingDate : t.filingDate,
      accession: t.id,
    })
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value)
}

export function summarizeTrades(trades: InsiderTrade[]): InsiderSummary {
  const buyTrades = trades.filter((t) => t.side === 'buy')
  const sellTrades = trades.filter((t) => t.side === 'sell')
  const buyValue = buyTrades.reduce((s, t) => s + t.value, 0)
  const sellValue = sellTrades.reduce((s, t) => s + t.value, 0)
  const netShares = buyTrades.reduce((s, t) => s + t.shares, 0) - sellTrades.reduce((s, t) => s + t.shares, 0)
  let mood: InsiderSummary['mood'] = 'neutral'
  if (buyTrades.length > 0 && buyValue >= sellValue) mood = 'buying'
  else if (sellTrades.length > 0 && sellValue > buyValue * 2) mood = 'selling'
  return { buys: buyTrades.length, sells: sellTrades.length, netShares, buyValue, sellValue, mood }
}

export function daysAgoISO(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

export interface DigestEntry {
  symbol: string
  name: string
  trades: InsiderTrade[]
}

// Top stocks by number of trades filed in the window; ties broken by traded value.
export function topByActivity(entries: DigestEntry[], limit = 3): DigestEntry[] {
  const total = (e: DigestEntry) => e.trades.reduce((s, t) => s + t.value, 0)
  return entries
    .filter((e) => e.trades.length > 0)
    .sort((a, b) => b.trades.length - a.trades.length || total(b) - total(a))
    .slice(0, limit)
}
