import { NextResponse } from 'next/server'
import { runDiscoveryScan } from '@/lib/discover'

export const maxDuration = 60

export async function POST() {
  try {
    const result = await runDiscoveryScan()
    return NextResponse.json(result)
  } catch (err) {
    console.error('Discovery scan failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Discovery scan failed' }, { status: 500 })
  }
}
