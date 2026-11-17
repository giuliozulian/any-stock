import type { Stock, WatchlistEntry } from '@prisma/client'
import { prisma } from './db'
import { checkTargets } from './alerts'
import { sendAlertEmail } from './notify'
import { getQuote } from './finnhub'

// Each watcher has their own targets and their own address. A target is marked as triggered only after the email was actually sent, so failures retry on the next check.
async function notifyEntries(stock: Stock, entries: WatchlistEntry[], price: number): Promise<void> {
  // Finnhub answers 0 for unknown or delisted symbols: a missing price must never look like a price below the entry target.
  if (!(price > 0)) return
  for (const entry of entries) {
    for (const kind of checkTargets(entry, price)) {
      const target = kind === 'entry' ? entry.entryPrice : entry.sellPrice
      if (target === null) continue
      const sent = await sendAlertEmail({ symbol: stock.symbol, name: stock.name, kind, price, target }, entry.userEmail)
      if (sent) {
        await prisma.watchlistEntry.update({
          where: { id: entry.id },
          data: kind === 'entry' ? { entryTriggeredAt: new Date() } : { sellTriggeredAt: new Date() },
        })
      }
    }
  }
}

export async function notifyTargets(stock: Stock, price: number): Promise<void> {
  const entries = await prisma.watchlistEntry.findMany({ where: { stockId: stock.id } })
  await notifyEntries(stock, entries, price)
}

// Lightweight check: only quotes for stocks with an armed target, no news/LLM work. One quote per stock, however many users watch it.
export async function checkAllAlerts(): Promise<{ checked: number; failed: number }> {
  const stocks = await prisma.stock.findMany({
    where: { watchers: { some: { OR: [{ entryPrice: { not: null }, entryTriggeredAt: null }, { sellPrice: { not: null }, sellTriggeredAt: null }] } } },
    include: { watchers: true },
  })
  let failed = 0
  for (const stock of stocks) {
    try {
      const quote = await getQuote(stock.symbol)
      await notifyEntries(stock, stock.watchers, quote.currentPrice)
    } catch (err) {
      failed++
      console.error(`Alert check failed for ${stock.symbol}:`, err instanceof Error ? err.message : String(err))
    }
  }
  return { checked: stocks.length, failed }
}
