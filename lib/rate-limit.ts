import { Prisma } from '@prisma/client'
import { getAuthedUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { dbEnabled } from '@/lib/shared-cache'

// Each bucket guards the quota of an external service that every user shares.
export const BUCKETS = {
  // Cheap lookups (search, quotes): the free Finnhub key allows 60 calls a minute in total.
  light: { limit: 120, windowMs: 60_000 },
  // Calls that fan out to Yahoo, Finnhub or an LLM (chart, refresh, add a stock).
  heavy: { limit: 30, windowMs: 60_000 },
  // A full market scan.
  scan: { limit: 3, windowMs: 60 * 60_000 },
} as const

export type Bucket = keyof typeof BUCKETS

const SWEEP_EVERY_MS = 60 * 60_000
let lastSweep = 0

// Counts this request against the user's bucket; returns a 429 response once it is over the limit, otherwise null.
// Requests without a user (the cron workflows) are not limited, and a failing database lets the request through.
export async function rateLimit(bucket: Bucket): Promise<Response | null> {
  if (!dbEnabled()) return null
  const user = await getAuthedUser()
  if (!user) return null
  const { limit, windowMs } = BUCKETS[bucket]
  const now = Date.now()
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs)
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${`${bucket}:${user.id}`}, ${windowStart}, 1)
      ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1
      RETURNING "count"`)
    if (now - lastSweep > SWEEP_EVERY_MS) {
      lastSweep = now
      await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now - 2 * 60 * 60_000) } } })
    }
    if (Number(rows[0]?.count ?? 0) <= limit) return null
    const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000))
    return Response.json({ error: 'Too many requests, try again shortly' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } })
  } catch (err) {
    console.error('Rate limit check failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}
