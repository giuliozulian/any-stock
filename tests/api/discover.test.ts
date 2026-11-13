import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as discoverLib from '@/lib/discover'
import { resetDb } from '../helpers/db'
import { POST as scan } from '@/app/api/discover/route'
import { PATCH as dismiss } from '@/app/api/discover/[symbol]/route'

describe('discover API', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('POST runs a scan and returns its summary', async () => {
    vi.spyOn(discoverLib, 'runDiscoveryScan').mockResolvedValue({ scannedAt: new Date('2026-11-13T10:00:00Z'), candidates: 3 })

    const res = await scan()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.candidates).toBe(3)
  })

  it('POST returns 500 on an unexpected error', async () => {
    vi.spyOn(discoverLib, 'runDiscoveryScan').mockRejectedValue(new Error('boom'))

    const res = await scan()

    expect(res.status).toBe(500)
  })

  it('PATCH marks a candidate as dismissed', async () => {
    await prisma.discoveredCandidate.create({
      data: { symbol: 'MSFT', name: 'Microsoft', market: 'US', score: 50, momentumScore: 50, fundamentalsScore: 50, insiderScore: 50, reason: 'test', source: 'yahoo-movers-us' },
    })

    const res = await dismiss(new Request('http://localhost/api/discover/MSFT', { method: 'PATCH' }), { params: Promise.resolve({ symbol: 'MSFT' }) })

    expect(res.status).toBe(200)
    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    expect(stored?.dismissedAt).not.toBeNull()
  })

  it('PATCH returns 404 for an unknown candidate', async () => {
    const res = await dismiss(new Request('http://localhost/api/discover/ZZZZ', { method: 'PATCH' }), { params: Promise.resolve({ symbol: 'ZZZZ' }) })

    expect(res.status).toBe(404)
  })
})
