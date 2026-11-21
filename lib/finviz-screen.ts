import { prisma } from '@/lib/db'
import { getDailyBars, type Bar } from '@/lib/history'
import { isLlmConfigured, requestLlmJson } from '@/lib/llm-news'
import { RS_MIN, percentileRank, type Criterion } from '@/lib/minervini'
import { fetchFinvizRows, passesTechnical, type FinvizFetchResult } from '@/lib/finviz'
import { VERDICT, planFor, sentence, toScanRow, type ScanRow } from '@/lib/scan-verdict'
import { toRow } from '@/lib/scanner-run'
import { MIN_PEERS, isUsSession, marketHealth, missingCriterion, scanSymbol, type ScanSymbolResult, type TradePlan } from '@/lib/scanner'
import { toYahooSymbol } from '@/lib/universe'

const MAX_PICKS = 40
const CONCURRENCY = 5
const MAX_NOTE = 260

export interface FinvizPick {
  symbol: string
  price: number
  passedCount: number
  rs: number | null
  verdict: keyof typeof VERDICT
  label: string
  plan: TradePlan
  text: string
  note: string | null
}

export interface FinvizScreen {
  total: number
  passedTechnical: number
  truncated: boolean
  noteAvailable: boolean
  picks: FinvizPick[]
  // Stocks of the list that were not in the last scan and now are.
  addedToScan: number
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

// The scanner's own ranking: peers are the readable stocks of the latest complete scan.
async function loadPeers() {
  const run = await prisma.scanRun.findFirst({ where: { status: 'done' }, orderBy: { finishedAt: 'desc' } })
  if (!run) return { returns: [] as number[], market: null }
  const results = await prisma.scanResult.findMany({ where: { runId: run.id, status: 'ok' }, select: { weightedReturn: true, criteria: true } })
  const returns = results.map((r) => r.weightedReturn).filter((r): r is number => r !== null)
  const market = marketHealth(results.map((r) => (Array.isArray(r.criteria) ? r.criteria : []) as unknown as Criterion[]))
  return { returns, market }
}

const NOTE_SYSTEM = `Sei un analista tecnico che applica il metodo di Mark Minervini. Per ogni titolo ricevi numeri già calcolati dall'app. Scrivi UNA nota di una o due frasi in italiano, per un investitore non esperto: perché il titolo è interessante e qual è il punto debole. Usa SOLO i numeri forniti, non inventare dati, non fare previsioni di prezzo e non dare consigli di acquisto o vendita.
Rispondi SOLO con un oggetto JSON: {"notes": {"SIMBOLO": "nota", ...}} con una voce per ogni simbolo ricevuto.`

export function parseNotes(json: unknown, symbols: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const notes = typeof json === 'object' && json !== null ? (json as { notes?: unknown }).notes : null
  if (typeof notes !== 'object' || notes === null) return out
  for (const symbol of symbols) {
    const text = (notes as Record<string, unknown>)[symbol]
    if (typeof text === 'string' && text.trim()) out.set(symbol, text.trim().slice(0, MAX_NOTE))
  }
  return out
}

async function geminiNotes(picks: Omit<FinvizPick, 'note'>[]): Promise<Map<string, string> | null> {
  if (picks.length === 0 || !isLlmConfigured()) return null
  const input = picks.map((p) => ({ symbol: p.symbol, controlliSuperati: `${p.passedCount}/8`, forzaRelativa: p.rs === null ? null : Math.round(p.rs), verdetto: p.label, prezzo: p.price, comprareTra: p.plan.buyFrom === null ? null : [p.plan.buyFrom, p.plan.buyTo], stop: p.plan.stop }))
  try {
    const result = await requestLlmJson(NOTE_SYSTEM, `Titoli (JSON):\n${JSON.stringify(input)}`)
    return result ? parseNotes(result.json, picks.map((p) => p.symbol)) : null
  } catch (err) {
    console.error('Finviz screen: Gemini notes failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

// The list replaces the previous Finviz list: the next scans cover it, and the last complete scan shows it right away.
async function addToScanner(found: { symbol: string; scan: ScanSymbolResult; rs: number | null; passedCount: number }[]): Promise<number> {
  await prisma.$transaction([
    prisma.scanExtra.deleteMany({ where: { source: 'finviz' } }),
    prisma.scanExtra.createMany({ data: found.map((f) => ({ symbol: f.symbol, name: f.symbol, source: 'finviz' })), skipDuplicates: true }),
  ])
  const run = await prisma.scanRun.findFirst({ where: { status: 'done' }, orderBy: { finishedAt: 'desc' } })
  if (!run || found.length === 0) return 0
  const have = new Set((await prisma.scanResult.findMany({ where: { runId: run.id, symbol: { in: found.map((f) => f.symbol) } }, select: { symbol: true } })).map((r) => r.symbol))
  const fresh = found.filter((f) => !have.has(f.symbol))
  if (fresh.length === 0) return 0
  const created = await prisma.scanResult.createMany({
    data: fresh.map((f) => ({ ...toRow(run.id, { symbol: f.symbol, name: f.symbol, sector: null }, f.scan), rs: f.rs, passedCount: f.passedCount })),
    skipDuplicates: true,
  })
  return created.count
}

export interface ScreenDeps {
  fetchList?: () => Promise<FinvizFetchResult>
  fetchBars?: (symbol: string) => Promise<Bar[]>
  now?: () => Date
}

export async function runFinvizScreen(deps: ScreenDeps = {}): Promise<FinvizScreen> {
  const list = await (deps.fetchList ?? fetchFinvizRows)()
  const survivors = list.rows.filter(passesTechnical).slice(0, MAX_PICKS)
  const fetchBars = deps.fetchBars ?? ((symbol: string) => getDailyBars(symbol))
  const { returns, market } = await loadPeers()
  const ctx = { caution: isUsSession((deps.now ?? (() => new Date()))()) ? ('session' as const) : null, market: market?.level ?? null }

  const scanned = await mapLimit(survivors, CONCURRENCY, async (row) => {
    const bars = await fetchBars(toYahooSymbol(row.symbol)).catch(() => [] as Bar[])
    return { row, scan: scanSymbol(bars) }
  })

  const picks: Omit<FinvizPick, 'note'>[] = []
  const found: { symbol: string; scan: ScanSymbolResult; rs: number | null; passedCount: number }[] = []
  for (const { row, scan } of scanned) {
    if (!scan) continue
    const rs = returns.length >= MIN_PEERS ? percentileRank(scan.weightedReturn, returns) : null
    const trend = scan.criteria.filter((c) => c.ok).length
    const passedCount = trend + (rs !== null && rs >= RS_MIN ? 1 : 0)
    found.push({ symbol: row.symbol, scan, rs, passedCount })
    const scanRow: ScanRow = { ...toScanRow({ symbol: row.symbol, name: row.symbol, sector: null, price: scan.price, rs, passedCount, vcpStatus: scan.vcpStatus, pivot: scan.pivot, pivotDistancePct: scan.pivotDistancePct, volumeRatio: scan.volumeRatio, volumeDryUp: scan.volumeDryUp, avwap: scan.avwap, criteria: scan.criteria }), missing: passedCount === 7 ? missingCriterion(scan.criteria, rs) : null }
    const { plan, note } = planFor(scanRow, ctx)
    picks.push({ symbol: row.symbol, price: scan.price, passedCount, rs, verdict: plan.verdict, label: VERDICT[plan.verdict].label, plan, text: sentence(scanRow, plan, note) })
  }
  picks.sort((a, b) => VERDICT[a.verdict].rank - VERDICT[b.verdict].rank || (b.rs ?? -1) - (a.rs ?? -1))

  const addedToScan = await addToScanner(found).catch((err) => {
    console.error('Finviz screen: adding to the scanner failed:', err instanceof Error ? err.message : String(err))
    return 0
  })
  const notes = await geminiNotes(picks)
  return {
    total: list.total,
    passedTechnical: survivors.length,
    truncated: list.truncated,
    noteAvailable: notes !== null,
    addedToScan,
    picks: picks.map((p) => ({ ...p, note: notes?.get(p.symbol) ?? null })),
  }
}
