import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: query, rateLimit: { deleteMany: vi.fn(async () => ({ count: 0 })) } } }))
const user = vi.fn()
vi.mock('@/lib/auth', () => ({ getAuthedUser: user }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('SHARED_CACHE_DB', '1')
  vi.stubEnv('DATABASE_URL', 'postgres://test')
  user.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
})

const run = async (bucket: 'light' | 'heavy' | 'scan' = 'heavy') => (await import('@/lib/rate-limit')).rateLimit(bucket)

describe('rateLimit', () => {
  it('lets a request through while the count is within the limit', async () => {
    query.mockResolvedValue([{ count: 30 }])
    expect(await run('heavy')).toBeNull()
  })

  it('answers 429 with Retry-After once the limit is passed', async () => {
    query.mockResolvedValue([{ count: 31 }])
    const res = await run('heavy')
    expect(res?.status).toBe(429)
    expect(Number(res?.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('uses a separate, smaller budget for a market scan', async () => {
    query.mockResolvedValue([{ count: 4 }])
    expect((await run('scan'))?.status).toBe(429)
    query.mockResolvedValue([{ count: 3 }])
    expect(await run('scan')).toBeNull()
  })

  it('does not limit requests without a user (cron)', async () => {
    user.mockResolvedValue(null)
    expect(await run()).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it('lets the request through when the database fails', async () => {
    query.mockRejectedValue(new Error('down'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await run()).toBeNull()
    quiet.mockRestore()
  })

  it('is off when the database level is off', async () => {
    vi.stubEnv('SHARED_CACHE_DB', '0')
    expect(await run()).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })
})
