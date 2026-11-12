import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateTargets } from '@/lib/alerts'

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

export async function PATCH(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()

  let body: { entryPrice?: unknown; sellPrice?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parse = (v: unknown): number | null | undefined => {
    if (v === null || v === '') return null
    if (v === undefined) return undefined
    return typeof v === 'number' ? v : Number(v)
  }
  const stock = await prisma.stock.findUnique({ where: { symbol } })
  if (!stock) {
    return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })
  }

  const entry = parse(body.entryPrice)
  const sell = parse(body.sellPrice)
  const nextEntry = entry === undefined ? stock.entryPrice : entry
  const nextSell = sell === undefined ? stock.sellPrice : sell
  const error = validateTargets(nextEntry, nextSell)
  if (error) {
    return NextResponse.json({ error }, { status: 400 })
  }

  // Changing or clearing a target re-arms it
  const updated = await prisma.stock.update({
    where: { symbol },
    data: {
      ...(entry !== undefined && { entryPrice: entry, entryTriggeredAt: null }),
      ...(sell !== undefined && { sellPrice: sell, sellTriggeredAt: null }),
    },
  })
  return NextResponse.json({ stock: updated })
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
