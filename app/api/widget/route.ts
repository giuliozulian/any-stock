import { connection } from 'next/server'
import { prisma } from '@/lib/db'

// Compact watchlist feed for iPhone widgets (Shortcuts / Scriptable). If WIDGET_TOKEN is set, ?token= must match.
export async function GET(req: Request) {
  await connection()
  const url = new URL(req.url)
  const required = process.env.WIDGET_TOKEN
  if (required && url.searchParams.get('token') !== required) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const stocks = await prisma.stock.findMany({
    orderBy: { symbol: 'asc' },
    select: { symbol: true, name: true, snapshots: { orderBy: { timestamp: 'desc' }, take: 1, select: { price: true, changePct: true, timestamp: true } } },
  })
  const items = stocks.map((s) => ({
    symbol: s.symbol,
    name: s.name,
    price: s.snapshots[0]?.price ?? null,
    changePct: s.snapshots[0]?.changePct ?? null,
    updatedAt: s.snapshots[0]?.timestamp ?? null,
  }))
  if (url.searchParams.get('format') === 'text') {
    const text = items.map((i) => `${i.symbol} ${i.price !== null ? i.price.toFixed(2) : '–'} ${i.changePct !== null ? `${i.changePct >= 0 ? '+' : ''}${i.changePct.toFixed(2)}%` : ''}`.trim()).join('\n')
    return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  return Response.json({ stocks: items })
}
