import { NextResponse } from 'next/server'
import { runDiscoveryScan } from '@/lib/discover'

export const maxDuration = 60

// Called by the evening workflow, so the candidates are fresh without anyone pressing the button.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const result = await runDiscoveryScan()
    return NextResponse.json({ candidates: result.candidates, scannedAt: result.scannedAt })
  } catch (err) {
    console.error('Discovery cron failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Discovery scan failed' }, { status: 500 })
  }
}
