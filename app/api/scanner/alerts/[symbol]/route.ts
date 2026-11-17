import { NextResponse } from 'next/server'
import { armAlert, disarmAlert } from '@/lib/scan-alerts-db'

type Context = { params: Promise<{ symbol: string }> }

const VALID = /^[A-Z0-9.-]{1,10}$/

async function symbolOf({ params }: Context): Promise<string | null> {
  const symbol = decodeURIComponent((await params).symbol).trim().toUpperCase()
  return VALID.test(symbol) ? symbol : null
}

export async function POST(_request: Request, context: Context) {
  const symbol = await symbolOf(context)
  if (!symbol) return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
  try {
    if ((await armAlert(symbol)) === 'unknown-symbol') return NextResponse.json({ error: 'Symbol not in the last scan' }, { status: 404 })
    return NextResponse.json({ symbol, armed: true })
  } catch (err) {
    console.error('Arming scan alert failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Could not arm the alert' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: Context) {
  const symbol = await symbolOf(context)
  if (!symbol) return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
  try {
    await disarmAlert(symbol)
    return NextResponse.json({ symbol, armed: false })
  } catch (err) {
    console.error('Disarming scan alert failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Could not disarm the alert' }, { status: 500 })
  }
}
