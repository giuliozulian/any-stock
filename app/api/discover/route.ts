import { NextResponse } from 'next/server'
import { runDiscoveryScan } from '@/lib/discover'
import { requireUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

const NDJSON = 'application/x-ndjson'

// Plain JSON by default. With `Accept: application/x-ndjson` the scan streams one JSON line per step ({step, done, total}),
// then a last line with the result (or an error), so the button can show where the scan is.
export async function POST(request?: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const limited = await rateLimit('scan')
  if (limited) return limited

  if (!request?.headers.get('accept')?.includes(NDJSON)) {
    try {
      return NextResponse.json(await runDiscoveryScan())
    } catch (err) {
      console.error('Discovery scan failed:', err instanceof Error ? err.message : String(err))
      return NextResponse.json({ error: 'Discovery scan failed' }, { status: 500 })
    }
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: object) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
      try {
        const result = await runDiscoveryScan((p) => send(p))
        send({ result: { scannedAt: result.scannedAt, candidates: result.candidates } })
      } catch (err) {
        console.error('Discovery scan failed:', err instanceof Error ? err.message : String(err))
        send({ error: 'Discovery scan failed' })
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': NDJSON, 'Cache-Control': 'no-store' } })
}
