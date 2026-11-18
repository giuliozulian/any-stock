import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { getAiNote } from '@/lib/minervini-ai-note'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/

export async function POST(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const limited = await rateLimit('heavy')
  if (limited) return limited

  const symbol = (await params).symbol.toUpperCase()
  if (!SYMBOL.test(symbol)) return NextResponse.json({ error: 'Simbolo non valido' }, { status: 400 })

  try {
    const note = await getAiNote(symbol)
    if (note.status === 'unavailable') return NextResponse.json({ error: 'Analisi AI non disponibile' }, { status: 503 })
    return NextResponse.json({ result: note.result, cached: note.cached })
  } catch (err) {
    console.error('Minervini AI failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Analisi AI non disponibile' }, { status: 503 })
  }
}
