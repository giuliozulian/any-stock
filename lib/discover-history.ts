import { prisma } from './db'
import { getDailyBars } from './history'
import { marketReturnSince } from './congress-benchmark'
import { getQuoteInfo } from './quote-info'

export interface PastPick {
  symbol: string
  name: string
  firstSeen: Date
  firstScore: number
  entryPrice: number
  priceNow: number
  returnPct: number
  // S&P 500 return over the same days; null when the benchmark is missing.
  marketPct: number | null
  excessPct: number | null
  days: number
}

export interface PicksSummary {
  count: number
  beat: number
  hitRate: number | null
  avgExcessPct: number | null
  high: { count: number; hitRate: number | null }
}

const WINDOW_DAYS = 90
// A younger proposal says nothing yet: a week is the shortest span worth judging.
const MIN_AGE_DAYS = 7
export const HIGH_SCORE = 65

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const rate = (picks: PastPick[]) => {
  const known = picks.filter((p) => p.excessPct !== null)
  return known.length ? known.filter((p) => p.excessPct! > 0).length / known.length : null
}

export function summarizePicks(picks: PastPick[]): PicksSummary {
  const known = picks.filter((p) => p.excessPct !== null)
  const high = picks.filter((p) => p.firstScore >= HIGH_SCORE)
  return {
    count: picks.length,
    beat: known.filter((p) => p.excessPct! > 0).length,
    hitRate: rate(picks),
    avgExcessPct: mean(known.map((p) => p.excessPct!)),
    high: { count: high.length, hitRate: rate(high) },
  }
}

export function buildPick(
  entry: { symbol: string; name: string; scannedAt: Date; score: number; price: number },
  priceNow: number,
  marketPct: number | null,
  now: number
): PastPick {
  const returnPct = ((priceNow - entry.price) / entry.price) * 100
  return {
    symbol: entry.symbol,
    name: entry.name,
    firstSeen: entry.scannedAt,
    firstScore: entry.score,
    entryPrice: entry.price,
    priceNow,
    returnPct,
    marketPct,
    excessPct: marketPct === null ? null : returnPct - marketPct,
    days: Math.floor((now - entry.scannedAt.getTime()) / 86_400_000),
  }
}

// Every stock the page proposed in the last 90 days, from the day it first appeared: how it did, and how it did against simply holding the S&P 500.
export async function getPastPicks(now: number = Date.now()): Promise<PastPick[]> {
  const since = new Date(now - WINDOW_DAYS * 86_400_000)
  const rows = await prisma.discoveryHistory.findMany({ where: { scannedAt: { gte: since }, price: { not: null } }, orderBy: { scannedAt: 'asc' } })
  const first = new Map<string, (typeof rows)[number]>()
  for (const r of rows) if (!first.has(r.symbol)) first.set(r.symbol, r)
  const old = [...first.values()].filter((r) => now - r.scannedAt.getTime() >= MIN_AGE_DAYS * 86_400_000)
  if (old.length === 0) return []

  const [infos, names, spy] = await Promise.all([
    getQuoteInfo(old.map((r) => r.symbol)).catch(() => new Map()),
    prisma.discoveredCandidate.findMany({ where: { symbol: { in: old.map((r) => r.symbol) } }, select: { symbol: true, name: true } }),
    getDailyBars('SPY').catch(() => []),
  ])
  const nameOf = new Map(names.map((n) => [n.symbol, n.name]))
  return old
    .flatMap((r) => {
      const priceNow = infos.get(r.symbol)?.price
      if (typeof priceNow !== 'number' || !r.price) return []
      return [buildPick({ symbol: r.symbol, name: nameOf.get(r.symbol) ?? r.symbol, scannedAt: r.scannedAt, score: r.score, price: r.price }, priceNow, spy.length ? marketReturnSince(spy, r.scannedAt.toISOString().slice(0, 10)) : null, now)]
    })
    .sort((a, b) => b.firstSeen.getTime() - a.firstSeen.getTime())
}
