import { getInsiderSentiment, getInsiderTransactions, type InsiderSentimentMonth } from './finnhub'
import { daysAgoISO, summarizeTrades, toTrades, type InsiderSummary, type InsiderTrade } from './insiders'

export interface InsiderData {
  trades: InsiderTrade[]
  summary: InsiderSummary
  sentiment: InsiderSentimentMonth[]
}

const TTL_MS = 6 * 60 * 60 * 1000
const WINDOW_DAYS = 180
const cache = new Map<string, { at: number; data: InsiderData | null }>()

// Returns null when Finnhub is unavailable, so the page can degrade without breaking.
export async function getInsiderData(symbol: string): Promise<InsiderData | null> {
  const hit = cache.get(symbol)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data

  const since = daysAgoISO(WINDOW_DAYS)
  let data: InsiderData | null = null
  try {
    const [transactions, sentiment] = await Promise.all([getInsiderTransactions(symbol), getInsiderSentiment(symbol, since).catch(() => [])])
    const trades = toTrades(transactions, since)
    data = { trades, summary: summarizeTrades(trades), sentiment: sentiment.slice(-6) }
  } catch (err) {
    console.error(`Insider data failed for ${symbol}:`, err instanceof Error ? err.message : String(err))
  }
  if (data) cache.set(symbol, { at: Date.now(), data })
  return data
}
