import { prisma } from '@/lib/db'

export async function resetDb(): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('test')) {
    throw new Error(
      `resetDb() refused: DATABASE_URL does not look like a test database (${url || '(empty)'})`
    )
  }

  await prisma.minerviniAiNote.deleteMany()
  await prisma.scanAlert.deleteMany()
  await prisma.scannerAlertSettings.deleteMany()
  await prisma.scanResult.deleteMany()
  await prisma.scanRun.deleteMany()
  await prisma.discoveredCandidate.deleteMany()
  await prisma.discoveryHistory.deleteMany()
  await prisma.discoveryDismissal.deleteMany()
  await prisma.analystRecommendation.deleteMany()
  await prisma.newsItem.deleteMany()
  await prisma.priceSnapshot.deleteMany()
  await prisma.stock.deleteMany()
}

interface WatchedData {
  symbol: string
  name: string
  exchange: string
  addedAt?: Date
  entryPrice?: number | null
  sellPrice?: number | null
  entryTriggeredAt?: Date | null
  sellTriggeredAt?: Date | null
}

// A stock that a user watches: the shared Stock row plus that user's own entry (the local no-login user by default).
export async function watch({ data }: { data: WatchedData }, userId = 'dev', userEmail = 'dev@local') {
  const { addedAt, entryPrice, sellPrice, entryTriggeredAt, sellTriggeredAt, ...shared } = data
  const stock = await prisma.stock.create({ data: shared })
  const entry = await prisma.watchlistEntry.create({ data: { userId, userEmail, stockId: stock.id, addedAt, entryPrice, sellPrice, entryTriggeredAt, sellTriggeredAt } })
  return { ...stock, entry }
}
