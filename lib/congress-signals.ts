import type { CongressBuy } from '@/lib/congress'
import type { MemberProfile, MemberStats } from '@/lib/politician-profiles'

export type Timing = 'early' | 'running' | 'late' | 'unknown'

export interface BuySignal {
  ticker: string
  asset: string
  members: string[]
  trades: number
  totalLow: number
  totalHigh: number
  firstDate: string
  lastDisclosedAt: string
  avgPerfPct: number | null
  timing: Timing
  // Average return since purchase minus the S&P 500 return over the same days.
  avgExcessPct: number | null
  // Other members who sold the same stock in the recent filings.
  sellers: number
  // Longest wait between a purchase and its public filing, in days.
  maxLagDays: number
  score: number
  reasons: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000
// The STOCK Act gives 45 days to file a trade.
export const FILING_DEADLINE_DAYS = 45
const EARLY_MAX_PCT = 5
const LATE_MIN_PCT = 20

export function timingOf(perf: number | null): Timing {
  if (perf === null) return 'unknown'
  if (perf <= EARLY_MAX_PCT) return 'early'
  return perf >= LATE_MIN_PCT ? 'late' : 'running'
}

// Ranks tickers by how worth a closer look they are: several different buyers, large amounts, fresh filings, buyers with influence or a good track record, and a price that has not run away yet.
export function daysSince(iso: string, now = Date.now()): number {
  return Math.floor((now - Date.parse(`${iso}T00:00:00Z`)) / DAY_MS)
}

export function lagDays(b: Pick<CongressBuy, 'date' | 'disclosedAt'>): number | null {
  if (!b.date || !b.disclosedAt) return null
  return Math.max(0, Math.round((Date.parse(`${b.disclosedAt}T00:00:00Z`) - Date.parse(`${b.date}T00:00:00Z`)) / DAY_MS))
}

export function rankSignals(
  buys: CongressBuy[],
  profiles: Map<string, MemberProfile>,
  stats: Map<string, MemberStats>,
  now = Date.now(),
  sellersByTicker: Map<string, Set<string>> = new Map()
): BuySignal[] {
  const by = new Map<string, CongressBuy[]>()
  for (const b of buys) by.set(b.ticker, [...(by.get(b.ticker) ?? []), b])

  const out: BuySignal[] = []
  for (const [ticker, list] of by) {
    const members = [...new Set(list.map((b) => b.member))]
    const totalLow = list.reduce((s, b) => s + b.amountLow, 0)
    const totalHigh = list.reduce((s, b) => s + b.amountHigh, 0)
    const lastDisclosedAt = list.reduce((m, b) => (b.disclosedAt > m ? b.disclosedAt : m), '')
    const firstDate = list.reduce((m, b) => (b.date < m ? b.date : m), list[0].date)
    const perfs = list.flatMap((b) => (b.perfPct === null ? [] : [b.perfPct]))
    const avgPerfPct = perfs.length ? perfs.reduce((a, b) => a + b, 0) / perfs.length : null
    const timing = timingOf(avgPerfPct)
    const excess = list.flatMap((b) => (b.perfPct !== null && typeof b.marketPct === 'number' ? [b.perfPct - b.marketPct] : []))
    const avgExcessPct = excess.length ? excess.reduce((a, b) => a + b, 0) / excess.length : null
    const sellers = [...(sellersByTicker.get(ticker) ?? [])].filter((m) => !members.includes(m)).length
    const maxLagDays = list.reduce((m, b) => Math.max(m, lagDays(b) ?? 0), 0)

    const reasons: string[] = []
    let score = 0
    if (members.length > 1) {
      score += Math.min(members.length, 5) * 3
      reasons.push(`${members.length} politici diversi`)
    }
    if (totalHigh >= 100_000) {
      score += Math.min(Math.log10(totalHigh / 10_000), 3)
      reasons.push('importi alti')
    }
    const ageDays = lastDisclosedAt ? (now - new Date(`${lastDisclosedAt}T00:00:00Z`).getTime()) / DAY_MS : Infinity
    if (ageDays <= 7) {
      score += 2
      reasons.push('pubblicato da pochi giorni')
    } else if (ageDays <= 14) score += 1
    const influential = members.filter((m) => profiles.get(m)?.influence === 'alta')
    if (influential.length) {
      score += 1.5
      reasons.push('c’è chi siede in commissioni chiave')
    }
    const skilled = members.filter((m) => (stats.get(m)?.purchases ?? 0) >= 3 && (stats.get(m)?.avgPerfPct ?? 0) >= 10)
    if (skilled.length) {
      score += 1.5
      reasons.push('tra loro chi ha un buon storico')
    }
    if (timing === 'early') {
      score += 2
      reasons.push('il prezzo non è ancora salito')
    } else if (timing === 'late') score -= 2
    if (sellers > 0) {
      score -= Math.min(sellers, 3)
      reasons.push(sellers === 1 ? 'un altro politico ha venduto' : `${sellers} altri politici hanno venduto`)
    }

    out.push({ ticker, asset: list[0].asset, members, trades: list.length, totalLow, totalHigh, firstDate, lastDisclosedAt, avgPerfPct, timing, avgExcessPct, sellers, maxLagDays, score, reasons })
  }
  return out.filter((s) => s.members.length > 1 || s.totalHigh >= 50_000).sort((a, b) => b.score - a.score || b.totalHigh - a.totalHigh)
}

export interface TopMember {
  member: string
  purchases: number
  avgPerfPct: number
  avgExcessPct: number | null
}

// Members with enough purchases to judge, sorted by how their buys beat the market since (or by raw return when the benchmark is missing).
export function topMembers(stats: Map<string, MemberStats>, minPurchases = 3, limit = 8): TopMember[] {
  return [...stats]
    .flatMap(([member, s]) => (s.purchases >= minPurchases && s.avgPerfPct !== null ? [{ member, purchases: s.purchases, avgPerfPct: s.avgPerfPct, avgExcessPct: s.avgExcessPct }] : []))
    .sort((a, b) => (b.avgExcessPct ?? b.avgPerfPct) - (a.avgExcessPct ?? a.avgPerfPct))
    .slice(0, limit)
}
