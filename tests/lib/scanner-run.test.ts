import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import type { Bar } from '@/lib/history'
import { BLOCK_SIZE, MIN_INTERVAL_MS, latestCompleteRun, loadExtras, runTiming, startRun, stepRun } from '@/lib/scanner-run'
import { loadUniverse } from '@/lib/universe'
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

  it('adds the watchlist and open candidates to the S&P 500, skipping duplicates, dismissed and foreign ones', async () => {
    await prisma.stock.createMany({
      data: [
        { symbol: 'RCEL', name: 'Avita', exchange: 'NASDAQ' },
        { symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ' },
        { symbol: 'ENI.MI', name: 'Eni', exchange: 'MIL' },
      ],
    })
    const cand = { name: 'X', market: 'US', score: 1, momentumScore: 1, fundamentalsScore: 1, insiderScore: 1, reason: '', source: 'congress' }
    await prisma.discoveredCandidate.createMany({
      data: [
        { ...cand, symbol: 'RCEL' },
        { ...cand, symbol: 'ZZZ' },
        { ...cand, symbol: 'OLD', dismissedAt: new Date() },
        { ...cand, symbol: 'ENEL.MI', market: 'IT' },
      ],
    })
    expect((await loadExtras()).map((e) => e.symbol)).toEqual(['RCEL', 'ZZZ'])

    const started = await startRun()
    if (started.kind === 'too-soon') throw new Error('unexpected')
    expect(started.run.total).toBe(loadUniverse().length + 2)

    const fetchBars = vi.fn(async () => uptrend(0.5))
    const base = loadUniverse().length
    await prisma.scanRun.update({ where: { id: started.run.id }, data: { cursor: base } })
    await stepRun(started.run.id, { fetchBars })
    const rows = await prisma.scanResult.findMany({ where: { runId: started.run.id } })
    expect(rows.map((r) => r.symbol).sort()).toEqual(['RCEL', 'ZZZ'])
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

  it('stores the volume ratio of each stock', async () => {
    const universe = entries(1)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')

    await stepRun(started.run.id, { universe, fetchBars: async () => uptrend(0.5) })

    const stored = await prisma.scanResult.findFirstOrThrow({ where: { runId: started.run.id } })
    expect(stored.volumeRatio).toBeCloseTo(1, 6)
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
    const fetchBars = vi.fn<(symbol: string) => Promise<Bar[]>>(async () => uptrend(0.5))

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

describe('closing a full-size run', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('ranks all 500+ stocks in one go without leaving a stock unranked', async () => {
    const universe = entries(520)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    await prisma.scanRun.update({ where: { id: started.run.id }, data: { cursor: 500 } })
    await prisma.scanResult.createMany({
      data: universe.slice(0, 500).map((e, i) => ({
        runId: started.run.id,
        symbol: e.symbol,
        name: e.name,
        status: 'ok',
        weightedReturn: i / 1000,
        criteria: Array.from({ length: 7 }, (_, k) => ({ id: k + 1, label: 'x', ok: true, value: '', margin: null })),
      })),
    })

    const step = await stepRun(started.run.id, { universe, fetchBars: async () => uptrend(0.5) })

    expect(step).toMatchObject({ kind: 'advanced', run: { status: 'done' } })
    expect(await prisma.scanResult.count({ where: { runId: started.run.id, status: 'ok', rs: null } })).toBe(0)
    expect(await prisma.scanResult.count({ where: { runId: started.run.id, status: 'ok', passedCount: null } })).toBe(0)
    const top = await prisma.scanResult.findFirstOrThrow({ where: { runId: started.run.id, symbol: 'S499' } })
    expect(top.rs).toBeCloseTo(100, 6)
    expect(top.passedCount).toBe(8)
  })
})

describe('runTiming', () => {
  const finished = new Date('2026-11-16T10:00:00Z')

  it('locks a new scan for an hour after the last one finished', () => {
    const t = runTiming(finished, new Date('2026-11-16T10:20:00Z'))
    expect(t.lockedUntil).toEqual(new Date(finished.getTime() + MIN_INTERVAL_MS))
    expect(t.ageDays).toBe(0)
  })

  it('does not lock after the hour and counts whole days of age', () => {
    const t = runTiming(finished, new Date('2026-11-18T11:00:00Z'))
    expect(t.lockedUntil).toBeNull()
    expect(t.ageDays).toBe(2)
  })

  it('handles a missing scan', () => {
    expect(runTiming(null, new Date())).toEqual({ lockedUntil: null, ageDays: 0 })
  })
})
