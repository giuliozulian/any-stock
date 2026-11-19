import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { searchSymbol, getProfile } from '@/lib/finnhub'
import { refreshStock } from '@/lib/refresh'
import { getYahooQuote } from '@/lib/yahoo-quote'
import { requireUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { currentUser, currentUserId, findEntry, flatten } from '@/lib/watchlist'

export async function GET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const entries = await prisma.watchlistEntry.findMany({
    where: { userId: await currentUserId() },
    orderBy: { addedAt: 'asc' },
    include: { stock: { include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 1 } } } },
  })
  const stocks = entries.map(flatten)
  return NextResponse.json({ stocks })
}

export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const limited = await rateLimit('heavy')
  if (limited) return limited
  let body: { symbol?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 })
  }

  const symbol = typeof body.symbol === 'string' ? body.symbol.toUpperCase().trim() : ''

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }

  const user = await currentUser()
  if (await findEntry(user.id, symbol)) {
    return NextResponse.json({ error: `${symbol} is already in the watchlist` }, { status: 409 })
  }

  // Someone else already follows it: the shared data is there, so no lookup and no refresh.
  const shared = await prisma.stock.findUnique({ where: { symbol } })
  if (shared) {
    const entry = await prisma.watchlistEntry.create({ data: { userId: user.id, userEmail: user.email, stockId: shared.id }, include: { stock: true } })
    return NextResponse.json({ stock: flatten(entry) }, { status: 201 })
  }

  let match
  let profile
  let finnhubError: string | null = null
  try {
    const matches = await searchSymbol(symbol)
    match = matches.find((m) => m.symbol === symbol)
    if (match) {
      profile = await getProfile(symbol)
    }
  } catch (err) {
    finnhubError = err instanceof Error ? err.message : String(err)
  }

  // Finnhub's free plan has no quotes outside the US: Yahoo can still vouch for a symbol such as an ETF on Borsa Italiana.
  let yahoo = null
  if (!match || finnhubError) {
    yahoo = await getYahooQuote(symbol)
    if (!yahoo && finnhubError) {
      return NextResponse.json({ error: `Finnhub lookup failed: ${finnhubError}` }, { status: 502 })
    }
  }

  if (!match && !yahoo) {
    return NextResponse.json({ error: `No symbol found for "${symbol}"` }, { status: 404 })
  }

  const entry = await prisma.watchlistEntry.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      stock: { create: { symbol, name: profile?.name || yahoo?.name || match?.description || symbol, exchange: profile?.exchange || yahoo?.exchange || 'UNKNOWN' } },
    },
    include: { stock: true },
  })

  await refreshStock(symbol)

  return NextResponse.json({ stock: flatten(entry) }, { status: 201 })
}
