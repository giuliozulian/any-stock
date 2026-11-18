import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getDailyBars, type Bar } from '@/lib/history'
import type { Criterion } from '@/lib/minervini'
import { notifyScanAlerts } from '@/lib/scan-alerts-db'
import { finalize, scanSymbol, type FinalizeInput, type ScanSymbolResult } from '@/lib/scanner'
import { loadUniverse, toYahooSymbol, type UniverseEntry } from '@/lib/universe'

export const BLOCK_SIZE = 25
export const CONCURRENCY = 5
// Block budget: 25 stocks at 5 in parallel with a 10 s timeout each is at most ~50 s without retries,
// so the retry pass only starts early in the block to stay under the route's 60 s.
export const RETRY_DEADLINE_MS = 30_000
export const MIN_INTERVAL_MS = 60 * 60 * 1000
export const KEEP_RUNS = 2
export const PARTIAL_UNREAD_SHARE = 0.1

export interface RunState {
  id: string
  status: string
  total: number
  cursor: number
}

export type StartResult = { kind: 'started' | 'resumed'; run: RunState } | { kind: 'too-soon'; retryAt: Date }
export type StepResult = { kind: 'advanced' | 'stale' | 'done'; run: RunState } | { kind: 'not-found' }

const state = (r: { id: string; status: string; total: number; cursor: number }): RunState => ({ id: r.id, status: r.status, total: r.total, cursor: r.cursor })

export function runningRun() {
  return prisma.scanRun.findFirst({ where: { status: 'running' }, orderBy: { startedAt: 'desc' } })
}

export function latestCompleteRun() {
  return prisma.scanRun.findFirst({ where: { status: 'done' }, orderBy: { finishedAt: 'desc' } })
}

const DAY_MS = 86_400_000

// When the next scan may start and how old the last result is, for the page.
export function runTiming(finishedAt: Date | null, now: Date): { lockedUntil: Date | null; ageDays: number } {
  if (!finishedAt) return { lockedUntil: null, ageDays: 0 }
  const unlock = finishedAt.getTime() + MIN_INTERVAL_MS
  return { lockedUntil: unlock > now.getTime() ? new Date(unlock) : null, ageDays: Math.floor((now.getTime() - finishedAt.getTime()) / DAY_MS) }
}

// Foreign listings carry an exchange suffix (ENI.MI); class shares have a single letter (BRK.B) and are US.
const FOREIGN_SYMBOL = /\.[A-Z]{2,}$/

// US stocks the user follows that the S&P 500 does not cover: the watchlist and the open discovery candidates.
export async function loadExtras(base: UniverseEntry[] = loadUniverse()): Promise<UniverseEntry[]> {
  const [watched, candidates] = await Promise.all([
    prisma.stock.findMany({ select: { symbol: true, name: true } }),
    prisma.discoveredCandidate.findMany({ where: { dismissedAt: null, market: 'US' }, select: { symbol: true, name: true } }),
  ])
  const seen = new Set(base.map((e) => e.symbol.toUpperCase()))
  const extras: UniverseEntry[] = []
  for (const s of [...watched, ...candidates]) {
    const symbol = s.symbol.toUpperCase()
    if (seen.has(symbol) || FOREIGN_SYMBOL.test(symbol)) continue
    seen.add(symbol)
    extras.push({ symbol, name: s.name, sector: null })
  }
  return extras.sort((a, b) => a.symbol.localeCompare(b.symbol))
}

// An explicit universe is scanned as given; by default the S&P 500 plus the extras.
export async function startRun(universe?: UniverseEntry[], now: Date = new Date()): Promise<StartResult> {
  const running = await runningRun()
  if (running) return { kind: 'resumed', run: state(running) }
  const last = await latestCompleteRun()
  if (last?.finishedAt && now.getTime() - last.finishedAt.getTime() < MIN_INTERVAL_MS) {
    return { kind: 'too-soon', retryAt: new Date(last.finishedAt.getTime() + MIN_INTERVAL_MS) }
  }
  const extras = universe ? [] : await loadExtras()
  const total = universe ? universe.length : loadUniverse().length + extras.length
  const run = await prisma.scanRun.create({ data: { status: 'running', total, extras: extras as unknown as Prisma.InputJsonValue } })
  return { kind: 'started', run: state(run) }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

export interface StepDeps {
  universe?: UniverseEntry[]
  fetchBars?: (yahooSymbol: string) => Promise<Bar[]>
  now?: () => number
}

export async function stepRun(runId: string, deps: StepDeps = {}): Promise<StepResult> {
  const fetchBars = deps.fetchBars ?? ((symbol: string) => getDailyBars(symbol, { shared: false }))
  const now = deps.now ?? Date.now

  const run = await prisma.scanRun.findUnique({ where: { id: runId } })
  if (!run) return { kind: 'not-found' }
  if (run.status === 'done') return { kind: 'done', run: state(run) }
  const universe = deps.universe ?? [...loadUniverse(), ...((run.extras as UniverseEntry[] | null) ?? [])]

  const from = run.cursor
  const block = universe.slice(from, from + BLOCK_SIZE)
  const to = from + block.length
  const startedAt = now()

  const results = await mapLimit(block, CONCURRENCY, async (entry) => scanSymbol(await fetchBars(toYahooSymbol(entry.symbol))))
  if (now() - startedAt < RETRY_DEADLINE_MS) {
    const failed = block.map((entry, i) => [entry, i] as const).filter(([, i]) => results[i] === null)
    const retried = await mapLimit(failed, CONCURRENCY, async ([entry]) => scanSymbol(await fetchBars(toYahooSymbol(entry.symbol))))
    failed.forEach(([, i], k) => {
      results[i] = retried[k]
    })
  }

  // Rows first (idempotent through skipDuplicates), cursor second: a crash never skips a block,
  // and a second tab running the same block only re-writes rows that already exist.
  if (block.length > 0) {
    await prisma.scanResult.createMany({ data: block.map((entry, i) => toRow(runId, entry, results[i])), skipDuplicates: true })
  }
  const claimed = await prisma.scanRun.updateMany({ where: { id: runId, cursor: from, status: 'running' }, data: { cursor: to } })
  if (claimed.count !== 1) {
    const current = await prisma.scanRun.findUniqueOrThrow({ where: { id: runId } })
    return { kind: 'stale', run: state(current) }
  }
  if (to >= run.total) await closeRun(runId)
  const current = await prisma.scanRun.findUniqueOrThrow({ where: { id: runId } })
  return { kind: 'advanced', run: state(current) }
}

// Json columns reject a plain null: leave the key out for unread rows.
function toRow(runId: string, entry: UniverseEntry, r: ScanSymbolResult | null): Prisma.ScanResultCreateManyInput {
  const base = { runId, symbol: entry.symbol, name: entry.name, sector: entry.sector }
  if (!r) return { ...base, status: 'unread' }
  return {
    ...base,
    status: 'ok',
    price: r.price,
    barDate: r.barDate,
    weightedReturn: r.weightedReturn,
    criteria: r.criteria as unknown as Prisma.InputJsonValue,
    vcpStatus: r.vcpStatus,
    pivot: r.pivot,
    pivotDistancePct: r.pivotDistancePct,
    contractions: r.contractions,
    volumeDryUp: r.volumeDryUp,
    volumeRatio: r.volumeRatio,
  }
}

async function closeRun(runId: string): Promise<void> {
  const rows = await prisma.scanResult.findMany({ where: { runId } })
  const readable = rows.filter((r) => r.status === 'ok' && r.weightedReturn !== null && r.criteria !== null)
  const inputs: FinalizeInput[] = readable.map((r) => ({ symbol: r.symbol, weightedReturn: r.weightedReturn!, criteria: r.criteria as unknown as Criterion[] }))
  const out = new Map(finalize(inputs).map((o) => [o.symbol, o]))
  // One statement for every row: hundreds of single updates in a transaction time out on a remote database.
  if (readable.length > 0) {
    const values = readable.map((r) => Prisma.sql`(${r.id}, ${out.get(r.symbol)!.rs}::float8, ${out.get(r.symbol)!.passedCount}::int)`)
    await prisma.$executeRaw`UPDATE "ScanResult" AS t SET "rs" = v.rs, "passedCount" = v.pc FROM (VALUES ${Prisma.join(values)}) AS v(id, rs, pc) WHERE t."id" = v.id`
  }

  const closed = await prisma.scanRun.updateMany({
    where: { id: runId, status: 'running' },
    data: { status: 'done', finishedAt: new Date(), unreadCount: rows.length - readable.length },
  })
  if (closed.count !== 1) return
  const done = await prisma.scanRun.findMany({ where: { status: 'done' }, orderBy: { finishedAt: 'desc' }, select: { id: true } })
  const old = done.slice(KEEP_RUNS).map((r) => r.id)
  if (old.length > 0) await prisma.scanRun.deleteMany({ where: { id: { in: old } } })
  // Only the caller that won the close sends the alerts, so two racing steps never send two emails.
  await notifyScanAlerts(runId)
}
