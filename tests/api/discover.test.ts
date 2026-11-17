import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as discoverLib from '@/lib/discover'
import { resetDb } from '../helpers/db'
import { POST as scan } from '@/app/api/discover/route'
import { PATCH as dismiss, DELETE as undo } from '@/app/api/discover/[symbol]/route'
import { GET as cron } from '@/app/api/cron/discover/route'

const ctx = (symbol: string) => ({ params: Promise.resolve({ symbol }) })
const patch = (symbol: string, body?: unknown) => dismiss(new Request(`http://localhost/api/discover/${symbol}`, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }), ctx(symbol))

describe('discover API', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('POST runs a scan and returns its summary', async () => {
    vi.spyOn(discoverLib, 'runDiscoveryScan').mockResolvedValue({ scannedAt: new Date('2026-11-13T10:00:00Z'), candidates: 3 })
    const res = await scan()
    expect(res.status).toBe(200)
    expect((await res.json()).candidates).toBe(3)
  })

  it('POST returns 500 on an unexpected error', async () => {
    vi.spyOn(discoverLib, 'runDiscoveryScan').mockRejectedValue(new Error('boom'))
    expect((await scan()).status).toBe(500)
  })

  it('POST streams the steps and the result when asked for ndjson', async () => {
    vi.spyOn(discoverLib, 'runDiscoveryScan').mockImplementation(async (onProgress) => {
      onProgress?.({ step: 'Raccolgo', done: 0, total: 5 })
      return { scannedAt: new Date('2026-11-13T10:00:00Z'), candidates: 2 }
    })
    const res = await scan(new Request('http://localhost/api/discover', { method: 'POST', headers: { accept: 'application/x-ndjson' } }))
    expect(res.headers.get('content-type')).toContain('ndjson')
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines[0]).toEqual({ step: 'Raccolgo', done: 0, total: 5 })
    expect(lines[1].result.candidates).toBe(2)
  })

  it('POST streams an error line when the scan fails', async () => {
    vi.spyOn(discoverLib, 'runDiscoveryScan').mockRejectedValue(new Error('boom'))
    const res = await scan(new Request('http://localhost/api/discover', { method: 'POST', headers: { accept: 'application/x-ndjson' } }))
    expect(JSON.parse((await res.text()).trim())).toEqual({ error: 'Discovery scan failed' })
  })
})

describe('hiding a candidate', () => {
  beforeEach(async () => {
    await resetDb()
    await prisma.discoveredCandidate.create({ data: { symbol: 'MSFT', name: 'Microsoft', market: 'US', score: 50, momentumScore: 50, fundamentalsScore: 50, insiderScore: 50, reason: 'test', source: 'peer' } })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T10:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('PATCH hides it for 30 days by default, for this user only', async () => {
    const res = await patch('MSFT')
    expect(res.status).toBe(200)
    const row = await prisma.discoveryDismissal.findFirstOrThrow({ where: { symbol: 'MSFT' } })
    expect(row.until).toEqual(new Date('2026-12-17T10:00:00Z'))
    expect(await prisma.discoveredCandidate.count({ where: { symbol: 'MSFT' } })).toBe(1)
  })

  it('PATCH can hide it for a chosen number of days or for good', async () => {
    await patch('MSFT', { days: 7 })
    expect((await prisma.discoveryDismissal.findFirstOrThrow()).until).toEqual(new Date('2026-11-24T10:00:00Z'))
    await patch('MSFT', { days: null })
    const rows = await prisma.discoveryDismissal.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].until).toBeNull()
  })

  it('PATCH caps an absurd number of days', async () => {
    await patch('MSFT', { days: 100000 })
    expect((await prisma.discoveryDismissal.findFirstOrThrow()).until).toEqual(new Date('2027-11-17T10:00:00Z'))
  })

  it('PATCH returns 404 for an unknown candidate', async () => {
    expect((await patch('ZZZZ')).status).toBe(404)
  })

  it('DELETE brings it back', async () => {
    await patch('MSFT')
    const res = await undo(new Request('http://localhost/api/discover/MSFT', { method: 'DELETE' }), ctx('MSFT'))
    expect(res.status).toBe(200)
    expect(await prisma.discoveryDismissal.count()).toBe(0)
  })
})

describe('discover cron', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('refuses a call without the cron secret', async () => {
    expect((await cron(new Request('http://localhost/api/cron/discover'))).status).toBe(401)
    expect((await cron(new Request('http://localhost/api/cron/discover', { headers: { authorization: 'Bearer nope' } }))).status).toBe(401)
  })

  it('runs the scan with the right secret', async () => {
    const run = vi.spyOn(discoverLib, 'runDiscoveryScan').mockResolvedValue({ scannedAt: new Date('2026-11-13T10:00:00Z'), candidates: 4 })
    const res = await cron(new Request('http://localhost/api/cron/discover', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }))
    expect(res.status).toBe(200)
    expect((await res.json()).candidates).toBe(4)
    expect(run).toHaveBeenCalled()
  })
})
