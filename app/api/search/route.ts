import { NextResponse } from 'next/server'
import { searchSymbol } from '@/lib/finnhub'

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 1) return NextResponse.json({ results: [] })
  try {
    const results = (await searchSymbol(q)).slice(0, 8).map((r) => ({ symbol: r.symbol, description: r.description, type: r.type }))
    return NextResponse.json({ results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
