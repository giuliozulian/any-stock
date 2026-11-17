import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { refreshStock } from '@/lib/refresh'
import { requireUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const limited = await rateLimit('heavy')
  if (limited) return limited
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
