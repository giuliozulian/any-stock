import { NextResponse } from 'next/server'
import { evaluateMatureVerdicts, recordVerdicts } from '@/lib/verdict-log'

export const maxDuration = 60

// Daily: logs today's verdict of every watched stock, then measures the verdicts whose horizon has matured.
// The two steps are independent: a failure in one does not stop the other.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const recorded = await recordVerdicts().catch((err) => {
    console.error('Recording verdicts failed:', err instanceof Error ? err.message : err)
    return null
  })
  const evaluated = await evaluateMatureVerdicts().catch((err) => {
    console.error('Evaluating verdicts failed:', err instanceof Error ? err.message : err)
    return null
  })

  return NextResponse.json({ recorded, evaluated })
}
