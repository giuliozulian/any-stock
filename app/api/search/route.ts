import { NextResponse } from 'next/server'
import { searchSymbols } from '@/lib/symbol-search'
import { requireUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const limited = await rateLimit('light')
  if (limited) return limited
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 1) return NextResponse.json({ results: [] })
  try {
    const results = (await searchSymbols(q)).map((r) => ({ symbol: r.symbol, description: r.description, type: r.type }))
    return NextResponse.json({ results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
