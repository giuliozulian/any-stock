import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { refreshStock } from '@/lib/refresh'

export async function POST(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()
  const stock = await prisma.stock.findUnique({ where: { symbol } })

  if (!stock) {
    return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })
  }

  const result = await refreshStock(symbol)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
