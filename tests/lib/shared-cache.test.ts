import { beforeEach, describe, expect, it, vi } from 'vitest'

const rows = new Map<string, { value: unknown }>()
const prismaMock = {
  cacheEntry: {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
    upsert: vi.fn(async ({ create }: { create: { key: string; value: unknown } }) => {
      rows.set(create.key, { value: create.value })
    }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
}
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

beforeEach(() => {
  rows.clear()
  vi.clearAllMocks()
  vi.resetModules()
  vi.stubEnv('SHARED_CACHE_DB', '1')
  vi.stubEnv('DATABASE_URL', 'postgres://test')
})

async function load() {
  return (await import('@/lib/shared-cache')).sharedCache<{ at: number; n: number }>
}

describe('sharedCache', () => {
  it('serves a fresh entry from memory without asking the database', async () => {
    const cache = (await load())('t')
    await cache.set('A', { at: Date.now(), n: 1 })
    prismaMock.cacheEntry.findUnique.mockClear()
    expect((await cache.get('A', 60_000))?.n).toBe(1)
    expect(prismaMock.cacheEntry.findUnique).not.toHaveBeenCalled()
  })

  it('lets a second instance read what the first one stored', async () => {
    const sharedCache = await load()
    await sharedCache('t').set('A', { at: 100, n: 7 })
    const other = sharedCache('t')
    expect((await other.get('A', 60_000))?.n).toBe(7)
  })

  it('prefers the newer copy of the two', async () => {
    const sharedCache = await load()
    const a = sharedCache('t')
    await a.set('A', { at: 200, n: 2 })
    rows.set('t:A', { value: { at: 300, n: 3 } })
    expect((await a.get('A'))?.n).toBe(3)
  })

  it('keeps working from memory when the database fails', async () => {
    const cache = (await load())('t')
    prismaMock.cacheEntry.upsert.mockRejectedValueOnce(new Error('down'))
    prismaMock.cacheEntry.findUnique.mockRejectedValueOnce(new Error('down'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(cache.set('A', { at: 1, n: 1 })).resolves.toBeUndefined()
    expect((await cache.get('A'))?.n).toBe(1)
    quiet.mockRestore()
  })

  it('stays in memory when the database level is off', async () => {
    vi.stubEnv('SHARED_CACHE_DB', '0')
    const cache = (await load())('t')
    await cache.set('A', { at: 1, n: 1 })
    expect(prismaMock.cacheEntry.upsert).not.toHaveBeenCalled()
    expect((await cache.get('A'))?.n).toBe(1)
  })
})
