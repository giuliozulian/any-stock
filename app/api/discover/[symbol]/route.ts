import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function PATCH(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()

  const candidate = await prisma.discoveredCandidate.findUnique({ where: { symbol } })
  if (!candidate) {
    return NextResponse.json({ error: `${symbol} is not a known candidate` }, { status: 404 })
  }

  const updated = await prisma.discoveredCandidate.update({
    where: { symbol },
    data: { dismissedAt: new Date() },
  })
  return NextResponse.json({ candidate: updated })
}
