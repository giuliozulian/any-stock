import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { buildChartData } from '@/lib/chart-data'
import { getDailyBars } from '@/lib/history'
import { toYahooSymbol } from '@/lib/universe'

const SYMBOL = /^[A-Z0-9.-]{1,10}$/

export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const limited = await rateLimit('heavy')
  if (limited) return limited
  const symbol = (await params).symbol.toUpperCase()
  if (!SYMBOL.test(symbol)) return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
  const bars = await getDailyBars(toYahooSymbol(symbol))
  if (bars.length === 0) return NextResponse.json({ error: `No prices for ${symbol}` }, { status: 404 })
  return NextResponse.json(buildChartData(bars))
}
