import { NextResponse } from 'next/server'
import { runDiscoveryScan } from '@/lib/discover'
import { requireUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

export async function POST() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const limited = await rateLimit('scan')
  if (limited) return limited
  try {
    const result = await runDiscoveryScan()
    return NextResponse.json(result)
  } catch (err) {
    console.error('Discovery scan failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Discovery scan failed' }, { status: 500 })
  }
}
