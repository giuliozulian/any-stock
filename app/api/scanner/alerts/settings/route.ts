import { NextResponse } from 'next/server'
import { setNewEntrants } from '@/lib/scan-alerts-db'
import { requireUser } from '@/lib/auth'
import { currentUser } from '@/lib/watchlist'

export async function PUT(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  let newEntrants: unknown
  try {
    newEntrants = ((await request.json()) as { newEntrants?: unknown }).newEntrants
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof newEntrants !== 'boolean') return NextResponse.json({ error: 'newEntrants must be true or false' }, { status: 400 })
  try {
    await setNewEntrants(await currentUser(), newEntrants)
    return NextResponse.json({ newEntrants })
  } catch (err) {
    console.error('Saving scan alert settings failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Could not save the setting' }, { status: 500 })
  }
}
