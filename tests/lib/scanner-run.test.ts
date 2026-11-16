import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import type { Bar } from '@/lib/history'
import { BLOCK_SIZE, MIN_INTERVAL_MS, latestCompleteRun, startRun, stepRun } from '@/lib/scanner-run'
import type { UniverseEntry } from '@/lib/universe'
import { resetDb } from '../helpers/db'

const DAY = 86_400_000
const uptrend = (slope: number): Bar[] =>
  Array.from({ length: 300 }, (_, i) => {
    const close = 100 + i * slope
    return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
  })

const entries = (n: number): UniverseEntry[] => Array.from({ length: n }, (_, i) => ({ symbol: `S${i}`, name: `Stock ${i}`, sector: 'Tech' }))

describe('scanner run', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('starts a run sized on the universe, then resumes it instead of starting another', async () => {
    const first = await startRun(entries(7))
    expect(first.kind).toBe('started')
    const again = await startRun(entries(7))
    expect(again.kind).toBe('resumed')
    if (first.kind !== 'too-soon' && again.kind !== 'too-soon') expect(again.run.id).toBe(first.run.id)
    expect(await prisma.scanRun.count()).toBe(1)
  })

  it('refuses a new run within an hour of the last complete one and gives the retry time', async () => {
    const finishedAt = new Date('2026-11-16T10:00:00Z')
    await prisma.scanRun.create({ data: { status: 'done', total: 5, cursor: 5, finishedAt } })
    const r = await startRun(entries(5), new Date('2026-11-16T10:30:00Z'))
    expect(r.kind).toBe('too-soon')
    if (r.kind === 'too-soon') expect(r.retryAt).toEqual(new Date(finishedAt.getTime() + MIN_INTERVAL_MS))
    const later = await startRun(entries(5), new Date('2026-11-16T11:00:01Z'))
    expect(later.kind).toBe('started')
  })

  it('processes a block, stores one row per stock and advances the cursor only after saving', async () => {
    const universe = entries(BLOCK_SIZE + 3)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = vi.fn(async () => uptrend(0.5))

    const step = await stepRun(started.run.id, { universe, fetchBars })

    expect(step).toMatchObject({ kind: 'advanced', run: { cursor: BLOCK_SIZE, status: 'running' } })
    expect(await prisma.scanResult.count({ where: { runId: started.run.id } })).toBe(BLOCK_SIZE)
    expect(fetchBars).toHaveBeenCalledTimes(BLOCK_SIZE)
  })

  it('marks short or missing history as unread and keeps going', async () => {
    const universe = entries(6)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = async (symbol: string) => (symbol === 'S0' ? [] : symbol === 'S1' ? uptrend(0.5).slice(0, 100) : uptrend(0.5))

    await stepRun(started.run.id, { universe, fetchBars })

    const rows = await prisma.scanResult.findMany({ where: { runId: started.run.id }, orderBy: { symbol: 'asc' } })
    expect(rows.filter((r) => r.status === 'unread').map((r) => r.symbol)).toEqual(['S0', 'S1'])
    expect(rows.find((r) => r.symbol === 'S0')!.criteria).toBeNull()
    expect(rows.filter((r) => r.status === 'ok')).toHaveLength(4)
  })

  it('asks Yahoo for dashed symbols but stores the dotted ones', async () => {
    const universe: UniverseEntry[] = [{ symbol: 'BRK.B', name: 'Berkshire', sector: 'Financials' }, { symbol: 'BF.B', name: 'Brown-Forman', sector: null }]
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = vi.fn(async (_symbol: string) => uptrend(0.5))

    await stepRun(started.run.id, { universe, fetchBars })

    expect(fetchBars.mock.calls.map((c) => c[0]).sort()).toEqual(['BF-B', 'BRK-B'])
    const symbols = (await prisma.scanResult.findMany({ where: { runId: started.run.id } })).map((r) => r.symbol).sort()
    expect(symbols).toEqual(['BF.B', 'BRK.B'])
  })

  it('retries a failed fetch once', async () => {
    const universe = entries(1)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    let calls = 0
    const fetchBars = async () => (++calls === 1 ? [] : uptrend(0.5))

    await stepRun(started.run.id, { universe, fetchBars })

    expect(calls).toBe(2)
    expect((await prisma.scanResult.findFirst({ where: { runId: started.run.id } }))!.status).toBe('ok')
  })

  it('skips the retry pass when the block already took too long', async () => {
    const universe = entries(1)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const times = [0, 31_000]
    const now = () => times.shift() ?? 31_000
    let calls = 0
    const fetchBars = async () => (++calls, [] as Bar[])

    await stepRun(started.run.id, { universe, fetchBars, now })

    expect(calls).toBe(1)
    expect((await prisma.scanResult.findFirst({ where: { runId: started.run.id } }))!.status).toBe('unread')
  })

  it('closes the run: ranks the stocks, counts unread ones and keeps only the last two complete runs', async () => {
    for (const hoursAgo of [30, 20, 10]) {
      await prisma.scanRun.create({ data: { status: 'done', total: 1, cursor: 1, finishedAt: new Date(Date.now() - hoursAgo * 3_600_000) } })
    }
    const universe = entries(8)
    const started = await startRun(universe, new Date())
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = async (symbol: string) => (symbol === 'S7' ? [] : uptrend(0.1 + Number(symbol.slice(1)) * 0.1))

    const step = await stepRun(started.run.id, { universe, fetchBars })

    expect(step.kind).toBe('advanced')
    if (step.kind === 'advanced') expect(step.run.status).toBe('done')
    const run = await prisma.scanRun.findUniqueOrThrow({ where: { id: started.run.id } })
    expect(run.status).toBe('done')
    expect(run.unreadCount).toBe(1)
    expect(run.finishedAt).not.toBeNull()
    const best = await prisma.scanResult.findFirstOrThrow({ where: { runId: run.id, symbol: 'S6' } })
    expect(best.rs).toBeCloseTo(100, 6)
    expect(best.passedCount).not.toBeNull()
    const unread = await prisma.scanResult.findFirstOrThrow({ where: { runId: run.id, symbol: 'S7' } })
    expect(unread.rs).toBeNull()
    expect(unread.passedCount).toBeNull()
    expect(await prisma.scanRun.count({ where: { status: 'done' } })).toBe(2)
    expect((await latestCompleteRun())!.id).toBe(run.id)
  })

  it('closes cleanly when nothing could be read', async () => {
    const universe = entries(3)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')

    const step = await stepRun(started.run.id, { universe, fetchBars: async () => [] })

    expect(step).toMatchObject({ kind: 'advanced', run: { status: 'done' } })
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: started.run.id } })).unreadCount).toBe(3)
  })

  it('lets only one of two concurrent steps on the same block advance', async () => {
    const universe = entries(BLOCK_SIZE + 5)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = async () => uptrend(0.5)

    const [a, b] = await Promise.all([stepRun(started.run.id, { universe, fetchBars }), stepRun(started.run.id, { universe, fetchBars })])

    expect([a.kind, b.kind].sort()).toEqual(['advanced', 'stale'])
    const run = await prisma.scanRun.findUniqueOrThrow({ where: { id: started.run.id } })
    expect(run.cursor).toBe(BLOCK_SIZE)
    expect(await prisma.scanResult.count({ where: { runId: run.id } })).toBe(BLOCK_SIZE)
  })

  it('finishes the run exactly once when two steps race on the last block', async () => {
    const universe = entries(4)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = async (s: string) => uptrend(0.1 + Number(s.slice(1)) * 0.1)

    await Promise.all([stepRun(started.run.id, { universe, fetchBars }), stepRun(started.run.id, { universe, fetchBars })])

    expect(await prisma.scanRun.count({ where: { status: 'done' } })).toBe(1)
    expect(await prisma.scanResult.count({ where: { runId: started.run.id } })).toBe(4)
  })

  it('reports an unknown run and a finished run without writing anything', async () => {
    expect(await stepRun('nope', { universe: entries(1), fetchBars: async () => [] })).toEqual({ kind: 'not-found' })
    const done = await prisma.scanRun.create({ data: { status: 'done', total: 1, cursor: 1, finishedAt: new Date() } })
    const r = await stepRun(done.id, { universe: entries(1), fetchBars: async () => uptrend(0.5) })
    expect(r.kind).toBe('done')
    expect(await prisma.scanResult.count()).toBe(0)
  })
})
