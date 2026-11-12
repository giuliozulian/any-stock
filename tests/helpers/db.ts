import { prisma } from '@/lib/db'

export async function resetDb(): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('test')) {
    throw new Error(
      `resetDb() refused: DATABASE_URL does not look like a test database (${url || '(empty)'})`
    )
  }

  await prisma.analystRecommendation.deleteMany()
  await prisma.newsItem.deleteMany()
  await prisma.priceSnapshot.deleteMany()
  await prisma.stock.deleteMany()
}
