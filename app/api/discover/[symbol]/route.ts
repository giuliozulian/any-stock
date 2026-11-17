import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { currentUserId } from '@/lib/watchlist'

const DEFAULT_SNOOZE_DAYS = 30
const MAX_SNOOZE_DAYS = 365

// Hides a candidate for the signed-in user only: for `days` days (30 by default) or, with {"days": null}, for good.
export async function PATCH(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()

  const candidate = await prisma.discoveredCandidate.findUnique({ where: { symbol } })
  if (!candidate) return NextResponse.json({ error: `${symbol} is not a known candidate` }, { status: 404 })

  const body = (await request.json().catch(() => ({}))) as { days?: unknown }
  let until: Date | null
  if (body.days === null) until = null
  else {
    const days = typeof body.days === 'number' && Number.isFinite(body.days) ? Math.min(Math.max(Math.round(body.days), 1), MAX_SNOOZE_DAYS) : DEFAULT_SNOOZE_DAYS
    until = new Date(Date.now() + days * 86_400_000)
  }
  const userId = await currentUserId()
  const dismissal = await prisma.discoveryDismissal.upsert({
    where: { userId_symbol: { userId, symbol } },
    create: { userId, symbol, until },
    update: { until },
  })
  return NextResponse.json({ dismissal })
}

// Undo: the candidate shows up again.
export async function DELETE(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const symbol = (await params).symbol.toUpperCase()
  const userId = await currentUserId()
  await prisma.discoveryDismissal.deleteMany({ where: { userId, symbol } })
  return NextResponse.json({ ok: true })
}
