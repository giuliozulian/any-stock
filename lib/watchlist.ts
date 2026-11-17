import { allowedEmails } from '@/lib/auth-config'
import { getAuthedUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import type { Prisma, Stock, WatchlistEntry } from '@prisma/client'

// The id of the signed-in user. Call it after requireUser(), which has already refused everyone else.
export async function currentUserId(): Promise<string> {
  const user = await getAuthedUser()
  if (!user) throw new Error('No signed-in user')
  return user.id
}

export async function currentUser(): Promise<{ id: string; email: string }> {
  const user = await getAuthedUser()
  if (!user) throw new Error('No signed-in user')
  return user
}

// A stock with the signed-in user's own fields (addedAt and the price targets) laid over the shared ones.
export type WatchedStock<S extends Stock = Stock> = Omit<S, 'createdAt'> & Pick<WatchlistEntry, 'addedAt' | 'entryPrice' | 'sellPrice' | 'entryTriggeredAt' | 'sellTriggeredAt'>

export function flatten<S extends Stock>(entry: WatchlistEntry & { stock: S }): WatchedStock<S> {
  const { createdAt: _createdAt, ...stock } = entry.stock
  void _createdAt
  return { ...stock, addedAt: entry.addedAt, entryPrice: entry.entryPrice, sellPrice: entry.sellPrice, entryTriggeredAt: entry.entryTriggeredAt, sellTriggeredAt: entry.sellTriggeredAt }
}

export function findEntry(userId: string, symbol: string) {
  return prisma.watchlistEntry.findFirst({ where: { userId, stock: { symbol } }, include: { stock: true } })
}

// Removes the user's entry; the stock itself (and its news and snapshots) goes only when nobody else watches it.
export async function removeEntry(entry: { id: string; stockId: string }): Promise<void> {
  await prisma.watchlistEntry.delete({ where: { id: entry.id } })
  const left = await prisma.watchlistEntry.count({ where: { stockId: entry.stockId } })
  if (left === 0) await prisma.stock.delete({ where: { id: entry.stockId } })
}

// Widget and calendar feeds cannot log in, so they show one person's list: FEED_USER_EMAIL, or the first address in AUTH_ALLOWED_EMAIL.
// With neither set (local development) they show every stock.
export function feedOwner(): Prisma.WatchlistEntryWhereInput {
  const email = process.env.FEED_USER_EMAIL?.trim().toLowerCase() || allowedEmails()[0]
  return email ? { userEmail: { equals: email, mode: 'insensitive' } } : {}
}

// Every stock somebody watches, for the jobs and pages that work on the shared data.
export const watchedBy = (where: Prisma.WatchlistEntryWhereInput): Prisma.StockWhereInput => ({ watchers: { some: where } })
