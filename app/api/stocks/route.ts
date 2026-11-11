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
  const body = await request.json()
  const symbol = typeof body.symbol === 'string' ? body.symbol.toUpperCase().trim() : ''

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }

  const existing = await prisma.stock.findUnique({ where: { symbol } })
  if (existing) {
    return NextResponse.json({ error: `${symbol} is already in the watchlist` }, { status: 409 })
  }

  const matches = await searchSymbol(symbol)
  const match = matches.find((m) => m.symbol === symbol)
  if (!match) {
    return NextResponse.json({ error: `No symbol found for "${symbol}"` }, { status: 404 })
  }

  const profile = await getProfile(symbol)

  const stock = await prisma.stock.create({
    data: {
      symbol,
      name: profile.name || match.description,
      exchange: profile.exchange,
    },
  })

  await refreshStock(symbol)

  return NextResponse.json({ stock }, { status: 201 })
}
