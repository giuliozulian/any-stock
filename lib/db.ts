import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function runtimeUrl(): string | undefined {
  // Supabase session pooler (5432) caps at 15 clients; use the transaction pooler (6543) at runtime
  return process.env.DATABASE_URL?.replace(':5432/', ':6543/')
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: runtimeUrl(), max: 3, idleTimeoutMillis: 10000 })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
