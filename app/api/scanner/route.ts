import { NextResponse } from 'next/server'
import { startRun } from '@/lib/scanner-run'

export async function POST() {
  try {
    const result = await startRun()
    if (result.kind === 'too-soon') {
      return NextResponse.json({ error: 'Ultima scansione troppo recente', retryAt: result.retryAt.toISOString() }, { status: 429 })
    }
    const { run } = result
    return NextResponse.json({ runId: run.id, cursor: run.cursor, total: run.total, status: run.status, resumed: result.kind === 'resumed' })
  } catch (err) {
    console.error('Scanner start failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Scanner start failed' }, { status: 500 })
  }
}
