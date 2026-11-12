import { NextResponse } from 'next/server'
import { refreshAllStocks } from '@/lib/refresh'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const results = await refreshAllStocks()
  const failed = results.filter((r) => !r.ok)

  return NextResponse.json({ refreshed: results.length, failed: failed.length, results })
}
