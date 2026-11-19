import type { InsiderTransaction } from './finnhub'

export type InsiderSide = 'buy' | 'sell'

export interface InsiderTrade {
  name: string
  side: InsiderSide
  shares: number
  price: number
  value: number
  date: string
  filingDate: string
  accession?: string
  role?: string | null
}

export interface InsiderSummary {
  buys: number
  sells: number
  netShares: number
  buyValue: number
  sellValue: number
  mood: 'buying' | 'selling' | 'neutral'
}

// Only open-market purchases (P) and sales (S): grants, gifts, option exercises and tax withholdings say nothing about conviction.
// By default tranches filed by the same person, same day and same side are merged into one operation (weighted average price); group=false keeps every row.
export function toTrades(transactions: InsiderTransaction[], sinceDate: string, group = true): InsiderTrade[] {
  const groups = new Map<string, InsiderTrade>()
  for (const t of transactions) {
    if ((t.code !== 'P' && t.code !== 'S') || t.change === 0 || t.transactionDate < sinceDate) continue
    const side: InsiderSide = t.code === 'P' ? 'buy' : 'sell'
    const shares = Math.abs(t.change)
    const key = group ? `${t.name}|${t.transactionDate}|${side}` : `${t.id ?? ''}|${groups.size}`
    const prev = groups.get(key)
    const value = shares * t.price + (prev?.value ?? 0)
    const totalShares = shares + (prev?.shares ?? 0)
    groups.set(key, {
      name: t.name,
      side,
      shares: totalShares,
      price: totalShares > 0 ? value / totalShares : 0,
      value,
      date: t.transactionDate,
      filingDate: prev && prev.filingDate > t.filingDate ? prev.filingDate : t.filingDate,
      accession: t.id,
    })
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value)
}

export function summarizeTrades(trades: InsiderTrade[]): InsiderSummary {
  const buyTrades = trades.filter((t) => t.side === 'buy')
  const sellTrades = trades.filter((t) => t.side === 'sell')
  const buyValue = buyTrades.reduce((s, t) => s + t.value, 0)
  const sellValue = sellTrades.reduce((s, t) => s + t.value, 0)
  const netShares = buyTrades.reduce((s, t) => s + t.shares, 0) - sellTrades.reduce((s, t) => s + t.shares, 0)
  let mood: InsiderSummary['mood'] = 'neutral'
  if (buyTrades.length > 0 && buyValue >= sellValue) mood = 'buying'
  else if (sellTrades.length > 0 && sellValue > buyValue * 2) mood = 'selling'
  return { buys: buyTrades.length, sells: sellTrades.length, netShares, buyValue, sellValue, mood }
}

export function daysAgoISO(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

export interface DigestEntry {
  symbol: string
  name: string
  trades: InsiderTrade[]
}

// Top stocks by number of trades filed in the window; ties broken by traded value.
export function topByActivity(entries: DigestEntry[], limit = 3): DigestEntry[] {
  const total = (e: DigestEntry) => e.trades.reduce((s, t) => s + t.value, 0)
  return entries
    .filter((e) => e.trades.length > 0)
    .sort((a, b) => b.trades.length - a.trades.length || total(b) - total(a))
    .slice(0, limit)
}

export interface InsiderCluster {
  from: string
  to: string
  insiders: number
  purchases: number
  total: number
  lead: { name: string; role: string | null; value: number }
  score: number
  trades: InsiderTrade[]
}

const CLUSTER_WINDOW_DAYS = 7
const CLUSTER_MAX_AGE_DAYS = 30

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

function roleWeight(role: string | null | undefined): number {
  if (!role) return 0
  if (/\b(ceo|chief executive|cfo|chief financial|president|chair)/i.test(role)) return 20
  if (/\b(officer|chief|coo|cto|vp|vice president|evp|svp|general counsel)/i.test(role)) return 12
  if (/director/i.test(role)) return 8
  return 4
}

// 0-100: how much money, how many people, how senior, how fresh. Our own heuristic, not a vendor score.
export function clusterScore(input: { total: number; insiders: number; roles: (string | null | undefined)[]; ageDays: number }): number {
  const money = Math.min(40, Math.max(0, (Math.log10(Math.max(input.total, 1)) - 4.5) * (40 / 2.5)))
  const people = Math.min(25, Math.max(0, (input.insiders - 1) * 10))
  const seniority = Math.max(0, ...input.roles.map(roleWeight))
  const fresh = Math.max(0, 15 * (1 - input.ageDays / CLUSTER_MAX_AGE_DAYS))
  return Math.round(money + people + seniority + fresh)
}

// The latest cluster of open-market purchases: the buys from 7 days before the most recent one up to it, when at least two different insiders bought and that last purchase is under 30 days old. Null otherwise.
export function buildCluster(trades: InsiderTrade[], now = new Date(), windowDays = CLUSTER_WINDOW_DAYS): InsiderCluster | null {
  const buys = trades.filter((t) => t.side === 'buy')
  if (buys.length === 0) return null
  const to = buys.reduce((max, t) => (t.date > max ? t.date : max), '')
  const today = now.toISOString().slice(0, 10)
  const ageDays = daysBetween(to, today)
  if (ageDays > CLUSTER_MAX_AGE_DAYS) return null
  const inWindow = buys.filter((t) => daysBetween(t.date, to) <= windowDays).sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value)
  const byPerson = new Map<string, { value: number; role: string | null }>()
  for (const t of inWindow) {
    const prev = byPerson.get(t.name)
    byPerson.set(t.name, { value: (prev?.value ?? 0) + t.value, role: prev?.role ?? t.role ?? null })
  }
  if (byPerson.size < 2) return null
  const [leadName, lead] = [...byPerson.entries()].sort((a, b) => b[1].value - a[1].value)[0]
  const total = inWindow.reduce((s, t) => s + t.value, 0)
  return {
    from: inWindow.reduce((min, t) => (t.date < min ? t.date : min), to),
    to,
    insiders: byPerson.size,
    purchases: inWindow.length,
    total,
    lead: { name: leadName, role: lead.role, value: lead.value },
    score: clusterScore({ total, insiders: byPerson.size, roles: [...byPerson.values()].map((p) => p.role), ageDays }),
    trades: inWindow,
  }
}
