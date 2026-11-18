import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { FinvizUnavailableError } from '@/lib/finviz'
import { runFinvizScreen } from '@/lib/finviz-screen'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

export async function POST(request: Request) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const limited = await rateLimit('scan')
  if (limited) return limited
  try {
    return NextResponse.json(await runFinvizScreen())
  } catch (err) {
    console.error('Finviz screen failed:', err instanceof Error ? err.message : String(err))
    if (err instanceof FinvizUnavailableError) return NextResponse.json({ error: `Finviz non risponde o ha bloccato la richiesta (${err.detail}). Riprova più tardi.` }, { status: 502 })
    return NextResponse.json({ error: 'La ricerca non è riuscita' }, { status: 500 })
  }
}
