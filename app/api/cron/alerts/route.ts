import { NextResponse } from 'next/server'
import { checkAllAlerts } from '@/lib/alert-runner'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return NextResponse.json(await checkAllAlerts())
}
