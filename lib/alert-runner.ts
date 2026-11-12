import type { Stock } from '@prisma/client'
import { prisma } from './db'
import { checkTargets } from './alerts'
import { sendAlertEmail } from './notify'
import { getQuote } from './finnhub'

// Marks a target as triggered only after the email was actually sent, so failures retry on the next check.
export async function notifyTargets(stock: Stock, price: number): Promise<void> {
  for (const kind of checkTargets(stock, price)) {
    const target = kind === 'entry' ? stock.entryPrice : stock.sellPrice
    if (target === null) continue
    const sent = await sendAlertEmail({ symbol: stock.symbol, name: stock.name, kind, price, target })
    if (sent) {
      await prisma.stock.update({
        where: { id: stock.id },
        data: kind === 'entry' ? { entryTriggeredAt: new Date() } : { sellTriggeredAt: new Date() },
      })
    }
  }
}

// Lightweight check: only quotes for stocks with an armed target, no news/LLM work.
export async function checkAllAlerts(): Promise<{ checked: number; failed: number }> {
  const stocks = await prisma.stock.findMany({
    where: { OR: [{ entryPrice: { not: null }, entryTriggeredAt: null }, { sellPrice: { not: null }, sellTriggeredAt: null }] },
  })
  let failed = 0
  for (const stock of stocks) {
    try {
      const quote = await getQuote(stock.symbol)
      await notifyTargets(stock, quote.currentPrice)
    } catch (err) {
      failed++
      console.error(`Alert check failed for ${stock.symbol}:`, err instanceof Error ? err.message : String(err))
    }
  }
  return { checked: stocks.length, failed }
}
