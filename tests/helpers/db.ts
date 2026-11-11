import { prisma } from '@/lib/db'

export async function resetDb(): Promise<void> {
  await prisma.newsItem.deleteMany()
  await prisma.priceSnapshot.deleteMany()
  await prisma.stock.deleteMany()
}
