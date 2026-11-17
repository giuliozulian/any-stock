import { NextResponse } from 'next/server'
import { stepRun } from '@/lib/scanner-run'
import { requireUser } from '@/lib/auth'

export const maxDuration = 60

export async function POST(request: Request) {
  const auth = await requireUser(request, { allowCron: true })
  if (!auth.ok) return auth.response
  let runId: unknown
  try {
    runId = ((await request.json()) as { runId?: unknown }).runId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof runId !== 'string' || runId.length === 0) return NextResponse.json({ error: 'runId required' }, { status: 400 })

  try {
    const result = await stepRun(runId)
    if (result.kind === 'not-found') return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    if (result.kind === 'done') return NextResponse.json({ error: 'Scan already finished' }, { status: 409 })
    const { run } = result
    return NextResponse.json({ cursor: run.cursor, total: run.total, status: run.status, advanced: result.kind === 'advanced' })
  } catch (err) {
    console.error('Scanner step failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Scanner step failed' }, { status: 500 })
  }
}
