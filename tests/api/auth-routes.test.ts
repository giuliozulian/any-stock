import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/db'
import { resetAuthWarning } from '@/lib/auth-config'
import { resetDb } from '../helpers/db'
import { GET as stocksGet, POST as stocksPost } from '@/app/api/stocks/route'
import { GET as stockGet, PATCH as stockPatch, DELETE as stockDelete } from '@/app/api/stocks/[symbol]/route'
import { POST as stockRefresh } from '@/app/api/stocks/[symbol]/refresh/route'
import { POST as discoverPost } from '@/app/api/discover/route'
import { PATCH as discoverPatch } from '@/app/api/discover/[symbol]/route'
import { GET as quotesGet } from '@/app/api/quotes/route'
import { GET as searchGet } from '@/app/api/search/route'
import { POST as scannerPost } from '@/app/api/scanner/route'
import { POST as scannerStep } from '@/app/api/scanner/step/route'
import { POST as alertPost, DELETE as alertDelete } from '@/app/api/scanner/alerts/[symbol]/route'
import { PUT as alertSettings } from '@/app/api/scanner/alerts/settings/route'

type Handler = (request: Request, context: { params: Promise<{ symbol: string }> }) => Promise<Response>
const ctx = { params: Promise.resolve({ symbol: 'AAPL' }) }
const json = (url: string, method: string) => new Request(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })

const PROTECTED: Array<[string, Handler, string, string]> = [
  ['GET /api/stocks', stocksGet as unknown as Handler, '/api/stocks', 'GET'],
  ['POST /api/stocks', stocksPost as unknown as Handler, '/api/stocks', 'POST'],
  ['GET /api/stocks/[symbol]', stockGet as unknown as Handler, '/api/stocks/AAPL', 'GET'],
  ['PATCH /api/stocks/[symbol]', stockPatch as unknown as Handler, '/api/stocks/AAPL', 'PATCH'],
  ['DELETE /api/stocks/[symbol]', stockDelete as unknown as Handler, '/api/stocks/AAPL', 'DELETE'],
  ['POST /api/stocks/[symbol]/refresh', stockRefresh as unknown as Handler, '/api/stocks/AAPL/refresh', 'POST'],
  ['POST /api/discover', discoverPost as unknown as Handler, '/api/discover', 'POST'],
  ['PATCH /api/discover/[symbol]', discoverPatch as unknown as Handler, '/api/discover/AAPL', 'PATCH'],
  ['GET /api/quotes', quotesGet as unknown as Handler, '/api/quotes?symbols=AAPL', 'GET'],
  ['GET /api/search', searchGet as unknown as Handler, '/api/search?q=apple', 'GET'],
  ['POST /api/scanner', scannerPost as unknown as Handler, '/api/scanner', 'POST'],
  ['POST /api/scanner/step', scannerStep as unknown as Handler, '/api/scanner/step', 'POST'],
  ['POST /api/scanner/alerts/[symbol]', alertPost as unknown as Handler, '/api/scanner/alerts/AAPL', 'POST'],
  ['DELETE /api/scanner/alerts/[symbol]', alertDelete as unknown as Handler, '/api/scanner/alerts/AAPL', 'DELETE'],
  ['PUT /api/scanner/alerts/settings', alertSettings as unknown as Handler, '/api/scanner/alerts/settings', 'PUT'],
]

const client = vi.mocked(createSupabaseServerClient)
const sessionOf = (email: string | null) =>
  client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: email === null ? null : { id: 'u1', email } }, error: null }) } } as never)

describe('protected routes', () => {
  beforeEach(async () => {
    await resetDb()
    client.mockReset()
    vi.stubEnv('AUTH_DISABLED', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
    vi.stubEnv('CRON_SECRET', 's3cret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetAuthWarning()
  })

  it.each(PROTECTED)('%s answers 401 without a session and does nothing', async (_name, handler, url, method) => {
    sessionOf(null)
    const res = await handler(json(url, method), ctx)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(await prisma.stock.count()).toBe(0)
    expect(await prisma.scanRun.count()).toBe(0)
  })

  it.each(PROTECTED)('%s answers 503, not 200, when auth is not configured', async (_name, handler, url, method) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    sessionOf('me@example.com')
    const res = await handler(json(url, method), ctx)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Auth not configured' })
  })

  it('lets the allowed user in: the watchlist loads as before', async () => {
    sessionOf('me@example.com')
    const res = await (stocksGet as unknown as Handler)(json('/api/stocks', 'GET'), ctx)
    expect(res.status).toBe(200)
  })

  it('accepts the cron secret on the scanner start route, and only there among the protected routes', async () => {
    sessionOf(null)
    const withSecret = (url: string, method: string) =>
      new Request(`http://localhost${url}`, { method, headers: { authorization: 'Bearer s3cret', 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })

    const start = await scannerPost(withSecret('/api/scanner', 'POST'))
    expect(start.status).toBe(200)
    expect(await prisma.scanRun.count()).toBe(1)

    expect((await (stocksGet as unknown as Handler)(withSecret('/api/stocks', 'GET'), ctx)).status).toBe(401)
    expect((await (discoverPost as unknown as Handler)(withSecret('/api/discover', 'POST'), ctx)).status).toBe(401)
  })

  it('refuses a wrong cron secret on the scanner routes', async () => {
    sessionOf(null)
    const wrong = new Request('http://localhost/api/scanner', { method: 'POST', headers: { authorization: 'Bearer nope' } })
    expect((await scannerPost(wrong)).status).toBe(401)
    expect(await prisma.scanRun.count()).toBe(0)
  })

  it('lets the cron secret reach the step route past the auth check (a bad body is then a 400, not a 401)', async () => {
    sessionOf(null)
    const step = new Request('http://localhost/api/scanner/step', { method: 'POST', headers: { authorization: 'Bearer s3cret' }, body: '{}' })
    expect((await scannerStep(step)).status).toBe(400)
  })
})
