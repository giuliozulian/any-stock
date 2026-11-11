import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 100 },
      news: { orderBy: { publishedAt: 'desc' }, take: 20 },
    },
  })

  if (!stock) {
    return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })
  }

  return NextResponse.json({ stock })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()
  const stock = await prisma.stock.findUnique({ where: { symbol } })

  if (!stock) {
    return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })
  }

  await prisma.stock.delete({ where: { symbol } })
  return NextResponse.json({ ok: true })
}
