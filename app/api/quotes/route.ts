import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getQuote } from '@/lib/finnhub'
import { requireUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { currentUserId } from '@/lib/watchlist'

// Live quotes straight from Finnhub (no DB write), only for symbols in the watchlist.
export async function GET(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const limited = await rateLimit('light')
  if (limited) return limited
  const raw = new URL(request.url).searchParams.get('symbols') ?? ''
  const requested = [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 50)
  if (requested.length === 0) return NextResponse.json({ quotes: {} })

  const known = (await prisma.watchlistEntry.findMany({ where: { userId: await currentUserId(), stock: { symbol: { in: requested } } }, select: { stock: { select: { symbol: true } } } })).map((e) => e.stock)
  const quotes: Record<string, { price: number; changePct: number }> = {}

  await Promise.all(
    known.map(async ({ symbol }) => {
      try {
        const q = await getQuote(symbol)
        if (q.currentPrice > 0) quotes[symbol] = { price: q.currentPrice, changePct: q.changePercent }
      } catch (err) {
        console.error(`Live quote failed for ${symbol}:`, err instanceof Error ? err.message : String(err))
      }
    })
  )

  return NextResponse.json({ quotes, at: Date.now() }, { headers: { 'Cache-Control': 'no-store' } })
}
