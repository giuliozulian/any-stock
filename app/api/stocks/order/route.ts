import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { currentUserId, reorderWatchlist } from '@/lib/watchlist'

const MAX_SYMBOLS = 500

export async function PUT(request: Request) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  let body: { symbols?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 })
  }
  const { symbols } = body
  if (!Array.isArray(symbols) || symbols.length > MAX_SYMBOLS || !symbols.every((s) => typeof s === 'string')) {
    return NextResponse.json({ error: 'symbols must be a list of symbols' }, { status: 400 })
  }
  const result = await reorderWatchlist(await currentUserId(), symbols.map((s) => s.toUpperCase().trim()))
  if (result === 'mismatch') return NextResponse.json({ error: 'The list does not match your watchlist: reload the page' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
