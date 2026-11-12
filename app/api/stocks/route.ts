import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { searchSymbol, getProfile } from '@/lib/finnhub'
import { refreshStock } from '@/lib/refresh'

export async function GET() {
  const stocks = await prisma.stock.findMany({
    orderBy: { addedAt: 'asc' },
    include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 1 } },
  })
  return NextResponse.json({ stocks })
}

export async function POST(request: Request) {
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

  const existing = await prisma.stock.findUnique({ where: { symbol } })
  if (existing) {
    return NextResponse.json({ error: `${symbol} is already in the watchlist` }, { status: 409 })
  }

  let match
  let profile
  try {
    const matches = await searchSymbol(symbol)
    match = matches.find((m) => m.symbol === symbol)
    if (match) {
      profile = await getProfile(symbol)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Finnhub lookup failed: ${message}` }, { status: 502 })
  }

  if (!match) {
    return NextResponse.json({ error: `No symbol found for "${symbol}"` }, { status: 404 })
  }

  const stock = await prisma.stock.create({
    data: {
      symbol,
      name: profile?.name || match.description,
      exchange: profile?.exchange || 'UNKNOWN',
    },
  })

  await refreshStock(symbol)

  return NextResponse.json({ stock }, { status: 201 })
}
