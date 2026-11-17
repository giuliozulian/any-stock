import { prisma } from '@/lib/db'

// Every entry carries the time it was stored: callers decide with their own TTL whether it is still fresh.
export interface Timed {
  at: number
}

export interface SharedCache<V extends Timed> {
  // With a ttl, a fresh copy in memory is returned without asking the database.
  get(key: string, ttlMs?: number): Promise<V | undefined>
  set(key: string, value: V): Promise<void>
}

// Entries older than this are never read again by any caller (the longest TTL in use is a day), so they are swept.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000
let lastSweep = 0

export function dbEnabled(): boolean {
  return process.env.SHARED_CACHE_DB !== '0' && Boolean(process.env.DATABASE_URL)
}

async function sweep(): Promise<void> {
  if (Date.now() - lastSweep < SWEEP_EVERY_MS) return
  lastSweep = Date.now()
  await prisma.cacheEntry.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - MAX_AGE_MS) } } })
}

// A two-level cache: this instance's memory first, then the database that every instance and user shares. A failing database
// degrades to memory only, so an external service is never hit more often than before and the page never breaks.
export function sharedCache<V extends Timed>(namespace: string): SharedCache<V> {
  const memory = new Map<string, V>()
  const id = (key: string) => `${namespace}:${key}`
  return {
    async get(key, ttlMs) {
      const local = memory.get(key)
      if (!dbEnabled()) return local
      if (local && ttlMs !== undefined && Date.now() - local.at < ttlMs) return local
      try {
        const row = await prisma.cacheEntry.findUnique({ where: { key: id(key) } })
        const stored = row?.value as V | undefined
        // The newer of the two wins: another instance may have refreshed it, or this one may hold a fresher copy.
        if (stored && (!local || stored.at > local.at)) {
          memory.set(key, stored)
          return stored
        }
      } catch (err) {
        console.error(`Shared cache read failed (${namespace}):`, err instanceof Error ? err.message : String(err))
      }
      return local
    },
    async set(key, value) {
      memory.set(key, value)
      if (!dbEnabled()) return
      try {
        const json = value as unknown as object
        await prisma.cacheEntry.upsert({ where: { key: id(key) }, create: { key: id(key), value: json }, update: { value: json } })
        await sweep()
      } catch (err) {
        console.error(`Shared cache write failed (${namespace}):`, err instanceof Error ? err.message : String(err))
      }
    },
  }
}
