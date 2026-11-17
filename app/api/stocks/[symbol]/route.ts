import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateTargets } from '@/lib/alerts'
import { requireUser } from '@/lib/auth'
import { currentUserId, findEntry, flatten, removeEntry } from '@/lib/watchlist'

export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()
  const entry = await prisma.watchlistEntry.findFirst({
    where: { userId: await currentUserId(), stock: { symbol } },
    include: {
      stock: {
        include: {
          snapshots: { orderBy: { timestamp: 'desc' }, take: 100 },
          news: { orderBy: { publishedAt: 'desc' }, take: 20 },
        },
      },
    },
  })

  if (!entry) {
    return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })
  }

  return NextResponse.json({ stock: flatten(entry) })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
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
  const watched = await findEntry(await currentUserId(), symbol)
  if (!watched) {
    return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })
  }

  const entry = parse(body.entryPrice)
  const sell = parse(body.sellPrice)
  const nextEntry = entry === undefined ? watched.entryPrice : entry
  const nextSell = sell === undefined ? watched.sellPrice : sell
  const error = validateTargets(nextEntry, nextSell)
  if (error) {
    return NextResponse.json({ error }, { status: 400 })
  }

  // Changing or clearing a target re-arms it
  const updated = await prisma.watchlistEntry.update({
    where: { id: watched.id },
    include: { stock: true },
    data: {
      ...(entry !== undefined && { entryPrice: entry, entryTriggeredAt: null }),
      ...(sell !== undefined && { sellPrice: sell, sellTriggeredAt: null }),
    },
  })
  return NextResponse.json({ stock: flatten(updated) })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()
  const entry = await findEntry(await currentUserId(), symbol)

  if (!entry) {
    return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })
  }

  await removeEntry(entry)
  return NextResponse.json({ ok: true })
}
