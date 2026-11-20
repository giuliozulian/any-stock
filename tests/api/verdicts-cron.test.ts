import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as verdictLog from '@/lib/verdict-log'
import { resetDb } from '../helpers/db'
import { GET as cronVerdicts } from '@/app/api/cron/verdicts/route'

const call = (token?: string) => cronVerdicts(new Request('http://localhost', { headers: token ? { authorization: `Bearer ${token}` } : {} }) as any)

describe('cron verdicts route', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('rejects a missing or wrong bearer token', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('wrong')).status).toBe(401)
  })

  it('rejects everything when no secret is configured', async () => {
    delete process.env.CRON_SECRET
    expect((await call('anything')).status).toBe(401)
  })

  it('records, then evaluates, and reports both', async () => {
    vi.spyOn(verdictLog, 'recordVerdicts').mockResolvedValue({ recorded: 2, skipped: 1, failed: 0 })
    vi.spyOn(verdictLog, 'evaluateMatureVerdicts').mockResolvedValue({ evaluated: 3, failed: 0 })

    const res = await call('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ recorded: { recorded: 2, skipped: 1, failed: 0 }, evaluated: { evaluated: 3, failed: 0 } })
  })

  it('still evaluates when recording throws, and reports null for the failed step', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(verdictLog, 'recordVerdicts').mockRejectedValue(new Error('db down'))
    vi.spyOn(verdictLog, 'evaluateMatureVerdicts').mockResolvedValue({ evaluated: 0, failed: 0 })

    const res = await call('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ recorded: null, evaluated: { evaluated: 0, failed: 0 } })
  })

  it('answers with zero counts on an empty database', async () => {
    await resetDb()
    const res = await call('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ recorded: { recorded: 0, skipped: 0, failed: 0 }, evaluated: { evaluated: 0, failed: 0 } })
  })
})
