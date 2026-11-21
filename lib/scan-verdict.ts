import { fundamentalsMisses, type Fundamentals } from '@/lib/fundamentals-gate'
import type { Criterion, VcpStatus } from '@/lib/minervini'
import type { MinerviniAnalysis } from '@/lib/minervini-data'
import {
  isUsSession,
  missingCriterion,
  tradePlan,
  withContext,
  type MarketLevel,
  type PlanContext,
  type PlanNote,
  type TradePlan,
  type Verdict,
} from '@/lib/scanner'

// One scanned stock as the page and the emails show it.
export interface ScanRow {
  symbol: string
  name: string
  sector: string | null
  price: number
  rs: number | null
  passedCount: number
  vcpStatus: VcpStatus | null
  pivot: number | null
  pivotDistancePct: number | null
  volumeRatio: number | null
  volumeDryUp?: boolean | null
  missing: string | null
  fundamentals?: Fundamentals | null
  // Anchored VWAP of the base.
  avwap?: number | null
  // Came in through the Finviz search rather than the S&P 500 list.
  fromFinviz?: boolean
}

export const fmtNum = (v: number, digits = 1) => v.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
export const fmtPrice = (v: number) => fmtNum(v, 2)

export const VERDICT: Record<Verdict, { label: string; tone: 'buy' | 'gain' | 'warn' | 'loss' | 'muted'; rank: number }> = {
  buy: { label: 'Si può comprare', tone: 'buy', rank: 0 },
  'weak-fundamentals': { label: 'Tecnico ok, fondamentali deboli', tone: 'warn', rank: 1 },
  noisy: { label: 'Base poco pulita', tone: 'warn', rank: 2 },
  confirm: { label: 'Aspetta conferma', tone: 'warn', rank: 3 },
  watch: { label: 'Da tenere d’occhio', tone: 'gain', rank: 4 },
  'no-base': { label: 'Nessun punto d’ingresso', tone: 'muted', rank: 5 },
  late: { label: 'Troppo tardi', tone: 'warn', rank: 6 },
  almost: { label: 'Non ancora pronto', tone: 'muted', rank: 7 },
  broken: { label: 'Da evitare', tone: 'loss', rank: 8 },
}

export const MARKET_TEXT: Record<MarketLevel, (pct: number) => string> = {
  healthy: (p) => `Mercato in salute: ${Math.round(p)}% dei titoli è sopra le medie a 150 e 200 giorni.`,
  neutral: (p) => `Mercato neutro: ${Math.round(p)}% dei titoli è sopra le medie a 150 e 200 giorni.`,
  weak: (p) => `Mercato debole: solo ${Math.round(p)}% dei titoli è sopra le medie a 150 e 200 giorni.`,
}

export function sentence(r: ScanRow, plan: TradePlan, note: PlanNote): string {
  const pivot = r.pivot === null ? '' : fmtPrice(r.pivot)
  if (note === 'session') return `Ha superato il livello chiave (${pivot}), ma il volume di oggi è parziale: la rottura non si può confermare. Rilancia la scansione a mercato chiuso.`
  if (note === 'below-avwap') return `Ha superato il livello chiave (${pivot}), ma il prezzo è sotto il VWAP ancorato al minimo della base (${r.avwap == null ? '' : fmtPrice(r.avwap)}): chi ha comprato in quella base è in perdita e può vendere. Meglio aspettare una conferma.`
  if (note === 'weak-market') return `Ha superato il livello chiave (${pivot}), ma il mercato è debole e la maggior parte delle rotture fallisce. Meglio aspettare.`
  switch (plan.verdict) {
    case 'buy':
      return `Il prezzo ha superato il livello chiave (${pivot}) con scambi forti${r.volumeRatio !== null ? ` (+${Math.round((r.volumeRatio - 1) * 100)}% sulla media)` : ''}. Per il metodo è il momento d’ingresso.`
    case 'weak-fundamentals':
      return `Il segnale tecnico c’è: ha superato il livello chiave (${pivot}) con scambi forti. Ma i fondamentali non reggono: ${fundamentalsMisses(r.fundamentals).join('; ')}. Il metodo vuole utili e ricavi in forte crescita: meglio non comprare.`
    case 'noisy':
      return `Ha superato il livello chiave (${pivot}) con scambi forti, ma la base era rumorosa: volumi alti nelle discese e nessun calo degli scambi. Per il metodo non è un ingresso pulito.`
    case 'confirm':
      return `Ha superato il livello chiave (${pivot}) ma con pochi scambi: queste rotture spesso falliscono. Meglio aspettare una conferma.`
    case 'watch':
      return `È in forma ma non ha ancora superato il livello chiave (${pivot}). Si compra solo se lo supera con scambi forti.`
    case 'late':
      return 'È già oltre il 5% sopra il livello chiave: comprare ora vuol dire inseguire il prezzo. Aspetta una nuova base.'
    case 'broken':
      return 'È sceso sotto l’ultimo minimo della base: il setup è saltato.'
    case 'no-base':
      return 'Trend forte ma nessuna base da cui entrare. Aspetta che il prezzo si fermi e ne formi una.'
    case 'almost':
      return `Manca un criterio: ${r.missing ?? 'uno dei controlli'}. Non è ancora in una tendenza solida.`
  }
}

// What to do with a stock once the context of the scan is known (partial volume, weak market).
export function planFor(row: ScanRow, ctx: PlanContext): { plan: TradePlan; note: PlanNote } {
  return withContext(tradePlan(row), ctx)
}

// The fields of a stored ScanResult that the page and the emails need.
export interface ResultLike {
  symbol: string
  name: string
  sector: string | null
  price: number | null
  rs: number | null
  passedCount: number | null
  vcpStatus: string | null
  pivot: number | null
  pivotDistancePct: number | null
  volumeRatio: number | null
  volumeDryUp?: boolean | null
  epsGrowthQoq?: number | null
  salesGrowthQoq?: number | null
  roe?: number | null
  avwap?: number | null
  criteria: unknown
}

export function toScanRow(r: ResultLike): ScanRow {
  const known = [r.epsGrowthQoq, r.salesGrowthQoq, r.roe].some((v) => v != null)
  return {
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    price: r.price ?? 0,
    rs: r.rs,
    passedCount: r.passedCount ?? 0,
    vcpStatus: r.vcpStatus as VcpStatus | null,
    pivot: r.pivot,
    pivotDistancePct: r.pivotDistancePct,
    volumeRatio: r.volumeRatio,
    volumeDryUp: r.volumeDryUp,
    fundamentals: known ? { epsGrowthQoq: r.epsGrowthQoq ?? null, salesGrowthQoq: r.salesGrowthQoq ?? null, roe: r.roe ?? null } : null,
    avwap: r.avwap ?? null,
    missing: r.passedCount === 7 ? missingCriterion((Array.isArray(r.criteria) ? r.criteria : []) as Criterion[], r.rs) : null,
  }
}

// Daily volume is only final once the US market has closed: a scan that touched the session has partial volume.
export function duringSession(startedAt: Date, finishedAt: Date | null): boolean {
  return isUsSession(startedAt) || (finishedAt !== null && isUsSession(finishedAt))
}

// The row the scanner would store for the stock, built from the analysis of the stock page: the tab and the scanner share one verdict.
export function rowFromAnalysis(symbol: string, a: MinerviniAnalysis): ScanRow {
  const price = a.template.levels.find((l) => l.key === 'price')?.value ?? 0
  const { pivot } = a.vcp
  return {
    symbol,
    name: symbol,
    sector: null,
    price,
    rs: null,
    passedCount: a.template.passedCount,
    vcpStatus: a.vcp.status,
    pivot,
    pivotDistancePct: pivot === null ? null : (price / pivot - 1) * 100,
    volumeRatio: a.vcp.volumeRatio,
    volumeDryUp: a.vcp.volumeDryUp,
    missing: null,
    fundamentals: a.fundamentals ?? null,
    avwap: a.avwap ?? a.vcp.avwap ?? null,
  }
}

export function planForAnalysis(symbol: string, a: MinerviniAnalysis, ctx: PlanContext = { caution: null, market: null }): { row: ScanRow; plan: TradePlan; note: PlanNote } {
  const row = rowFromAnalysis(symbol, a)
  return { row, ...planFor(row, ctx) }
}
