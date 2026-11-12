import { NextResponse } from 'next/server'
import { sendInsiderDigest } from '@/lib/insider-digest'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return NextResponse.json(await sendInsiderDigest())
}
