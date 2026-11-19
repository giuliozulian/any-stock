import { reviewTopCandidates } from './candidate-review'
import { getRecentCongressBuys, getRecentCongressSellers } from './congress'
import { withMarketReturn } from './congress-benchmark'
import { memberStats, getMemberProfiles } from './politician-profiles'
import { rankSignals } from './congress-signals'
import { prisma } from './db'
import { getQuote, getMetrics, getNextEarnings, getPeers, getIpoCalendar } from './finnhub'
import { getInsiderData } from './insider-data'
import { buildCluster } from './insiders'
import { getForm4ClusterSeeds } from './edgar-form4-feed'
import { getMarketBigMovers } from './market'
import { getQuoteInfo, type QuoteInfo } from './quote-info'
import { getEarningsFeed, surprise } from './earnings'
import { getDailyBars } from './history'
import { tradingDay } from './move-explanation'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number) => Math.round(v)
const formatUsd = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} mln $` : `${Math.round(n / 1_000)}k $`)

// A pillar that cannot be measured is stored as -1: it is left out of the total instead of counting as zero.
export const UNKNOWN = -1

export interface CongressInfo {
  members: number
  trades: number
  totalLow: number
  totalHigh: number
  reasons: string[]
}

export interface ScoreInput {
  market: 'US' | 'IT'
  price: number
  changePct: number
  week52High: number | null
  week52Low: number | null
  roe: number | null
  pegRatio: number | null
  debtToEquity: number | null
  netMargin: number | null
  epsGrowth5Y: number | null
  congressSignalScore: number | null
  congressInfo?: CongressInfo | null
  // Other members of Congress who sold the same stock.
  congressSellers?: number
  insiderBuyerCount: number
  insiderSellerCount?: number
  // False when the insider data could not be read (and for Italy, where there is none).
  insiderKnown?: boolean
  // Days to the next earnings report, when known.
  daysToEarnings?: number | null
}

export interface CandidateScore {
  // Column names are historical: momentumScore is the "Momento" pillar, fundamentalsScore "Qualità", insiderScore "Persone".
  momentumScore: number
  fundamentalsScore: number
  insiderScore: number
  score: number
  reason: string
  flags: string[]
}

const EXTENDED_RISE_PCT = 15
const MIN_QUALITY_COMPONENTS = 2

const grade = (v: number | null, steps: Array<[number, number]>, otherwise: number): number | null => {
  if (v === null) return null
  for (const [limit, points] of steps) if (v > limit) return points
  return otherwise
}

// Quality of the business, from whatever the data source has: each ratio is graded 0-100 and the available ones are averaged.
export function qualityScoreOf(input: ScoreInput): number {
  const parts = [
    grade(input.roe, [[15, 100], [8, 65], [0, 35]], 0),
    input.pegRatio === null || input.pegRatio <= 0 ? null : input.pegRatio <= 1 ? 100 : input.pegRatio <= 2 ? 60 : input.pegRatio <= 3 ? 25 : 0,
    // Negative equity is not low debt: liabilities exceed assets.
    input.debtToEquity === null ? null : input.debtToEquity < 0 ? 0 : input.debtToEquity < 0.5 ? 100 : input.debtToEquity < 1 ? 75 : input.debtToEquity < 2 ? 40 : 10,
    grade(input.netMargin, [[20, 100], [10, 70], [0, 40]], 0),
    grade(input.epsGrowth5Y, [[15, 100], [5, 65], [0, 35]], 0),
  ].filter((p): p is number => p !== null)
  return parts.length < MIN_QUALITY_COMPONENTS ? UNKNOWN : round(parts.reduce((a, b) => a + b, 0) / parts.length)
}

// Is there still time to look? Not a trend measure (the Minervini scan does that): it only punishes a late or risky moment.
export function timingScoreOf(input: ScoreInput): number {
  let base = 60
  if (input.week52High !== null && input.week52Low !== null && input.week52High > input.week52Low) {
    const p = clamp((input.price - input.week52Low) / (input.week52High - input.week52Low), 0, 1)
    base = p < 0.2 ? 30 : p < 0.7 ? 90 : p < 0.9 ? 70 : 50
  }
  if (input.changePct >= 25) base -= 25
  else if (input.changePct >= EXTENDED_RISE_PCT) base -= 10
  else if (input.changePct <= -EXTENDED_RISE_PCT) base -= 15
  const days = input.daysToEarnings
  if (days !== null && days !== undefined) base -= days <= 3 ? 20 : days <= 7 ? 10 : 0
  return clamp(round(base), 0, 100)
}

// Who is acting: politicians and company insiders. Sales of the insiders weigh against the buys.
export function peopleScoreOf(input: ScoreInput): number {
  if (input.market === 'IT') return UNKNOWN
  const hasCongress = input.congressSignalScore !== null
  if (!hasCongress && input.insiderKnown === false) return UNKNOWN
  const congressPoints = hasCongress ? clamp((input.congressSignalScore! / 12) * 100, 0, 100) : 0
  const insiderPoints = clamp(input.insiderBuyerCount * 25 - (input.insiderSellerCount ?? 0) * 10, 0, 100)
  return round(Math.max(congressPoints, insiderPoints))
}

export function flagsOf(input: ScoreInput, pillars: { quality: number }): string[] {
  const flags: string[] = []
  const days = input.daysToEarnings
  if (days !== null && days !== undefined && days <= 7) flags.push(days <= 0 ? 'Trimestrale oggi' : days === 1 ? 'Trimestrale domani' : `Trimestrale tra ${days} giorni`)
  if (input.changePct >= EXTENDED_RISE_PCT) flags.push('Già salito molto oggi')
  if (input.changePct <= -EXTENDED_RISE_PCT) flags.push('In forte calo oggi')
  if ((input.insiderSellerCount ?? 0) >= 2 && (input.insiderSellerCount ?? 0) > input.insiderBuyerCount) flags.push('I dirigenti stanno vendendo')
  if ((input.congressSellers ?? 0) > 0) flags.push('Venduto anche da altri politici')
  if (pillars.quality === UNKNOWN) flags.push('Conti non disponibili')
  return flags
}

function buildReason(input: ScoreInput, p: { people: number; quality: number; timing: number }, event: string | null): string {
  const parts: string[] = []
  if (event) parts.push(event)
  if (p.people >= 50) parts.push(input.congressSignalScore !== null ? 'politici USA hanno comprato di recente' : "dirigenti dell'azienda hanno comprato azioni di recente")
  if (p.quality >= 60) {
    const strong: string[] = []
    if (input.roe !== null && input.roe > 15) strong.push(`rende bene (ROE ${input.roe.toFixed(0)}%)`)
    if (input.debtToEquity !== null && input.debtToEquity >= 0 && input.debtToEquity < 1) strong.push('ha poco debito')
    if (input.netMargin !== null && input.netMargin > 15) strong.push(`ha margini alti (${input.netMargin.toFixed(0)}%)`)
    parts.push(`l'azienda ${strong.length ? strong.join(' e ') : 'ha conti discreti'}`)
  }
  if (p.timing >= 80) parts.push('il prezzo non ha ancora corso')
  if (parts.length === 0) parts.push('segnali deboli: è qui solo perché ha attirato l’attenzione dello scanner')
  const headline = parts.join(', ')
  const lines = [headline.charAt(0).toUpperCase() + headline.slice(1) + '.']

  // Detail lines, in the order of the pillars on the card: Persone, Qualità, Momento.
  if (input.market === 'IT') {
    lines.push('Per i titoli italiani non ci sono dati su acquisti di dirigenti e politici: il punteggio usa solo Qualità e Momento.')
  } else {
    const c = input.congressInfo
    let congressText = 'Nessun acquisto recente di politici USA.'
    if (c) {
      const who = c.members === 1 ? '1 politico ha' : `${c.members} politici hanno`
      const amount = c.totalHigh > 0 ? ` per ${formatUsd(c.totalLow)}–${formatUsd(c.totalHigh)}` : ''
      const why = c.reasons.length ? ` (${c.reasons.join(', ')})` : ''
      congressText = `${who} comprato${amount} in ${c.trades} ${c.trades === 1 ? 'operazione' : 'operazioni'}${why}.`
    } else if (input.congressSignalScore !== null) congressText = 'Acquisti recenti da parte di politici USA.'
    const buyers = input.insiderBuyerCount
    const sellers = input.insiderSellerCount ?? 0
    const insiderText =
      input.insiderKnown === false
        ? 'Dati sugli insider non disponibili.'
        : `${buyers === 0 ? 'Nessun dirigente ha comprato' : buyers === 1 ? '1 dirigente ha comprato' : `${buyers} dirigenti hanno comprato`}${sellers > 0 ? ` e ${sellers} ${sellers === 1 ? 'ha venduto' : 'hanno venduto'}` : ''} negli ultimi 30 giorni.`
    lines.push(`${congressText} ${insiderText} Il voto prende il più alto tra politici e insider; le vendite dei dirigenti lo abbassano.`)
  }

  const quality = [
    input.roe !== null ? `ROE ${input.roe.toFixed(0)}%` : null,
    input.netMargin !== null ? `margine netto ${input.netMargin.toFixed(0)}%` : null,
    input.epsGrowth5Y !== null ? `utili per azione ${input.epsGrowth5Y >= 0 ? '+' : ''}${input.epsGrowth5Y.toFixed(0)}% l'anno (5 anni)` : null,
    input.pegRatio !== null && input.pegRatio > 0 ? `PEG ${input.pegRatio.toFixed(1)}` : null,
    input.debtToEquity !== null ? (input.debtToEquity < 0 ? 'patrimonio netto negativo' : `debito/patrimonio ${input.debtToEquity.toFixed(1)}`) : null,
  ].filter(Boolean)
  lines.push(quality.length ? `${quality.join(', ')}.` : 'Dati sui conti non disponibili: questa parte non entra nel voto.')

  const sign = input.changePct >= 0 ? '+' : ''
  let range = ''
  if (input.week52High !== null && input.week52Low !== null && input.week52High > input.week52Low) {
    const pos = clamp((input.price - input.week52Low) / (input.week52High - input.week52Low), 0, 1) * 100
    range = ` Il prezzo è al ${pos.toFixed(0)}% tra il minimo e il massimo degli ultimi 12 mesi.`
  }
  const earnings = input.daysToEarnings !== null && input.daysToEarnings !== undefined && input.daysToEarnings <= 14 ? ` La trimestrale è tra ${Math.max(0, input.daysToEarnings)} giorni.` : ''
  lines.push(`Oggi il titolo fa ${sign}${input.changePct.toFixed(1)}%.${range}${earnings} Il voto scende se ha già corso molto o se i conti sono vicini: per il trend tecnico c'è Minervini SCAN.`)
  return lines.join('\n')
}

export function scoreCandidate(input: ScoreInput, event: string | null = null): CandidateScore {
  const people = peopleScoreOf(input)
  const quality = qualityScoreOf(input)
  const timing = timingScoreOf(input)
  const known = [people, quality, timing].filter((p) => p !== UNKNOWN)
  const score = round(known.reduce((a, b) => a + b, 0) / known.length)
  return {
    momentumScore: timing,
    fundamentalsScore: quality,
    insiderScore: people,
    score,
    reason: buildReason(input, { people, quality, timing }, event),
    flags: flagsOf(input, { quality }),
  }
}

export type SeedSource = 'congress' | 'edgar-form4-cluster' | 'earnings-beat' | 'ipo' | 'peer' | 'movers-it'

export interface CandidateSeed {
  symbol: string
  name: string
  market: 'US' | 'IT'
  source: string[]
  seedPrice: number | null
  seedChangePct: number | null
  congressScore: number | null
  clusterBuyerCount: number | null
  congressInfo?: CongressInfo | null
  congressSellers?: number
  // What brought it here, in one sentence, for the first line of the reason.
  event?: string | null
}

const MIN_EARNINGS_BEAT_PCT = 15
const BEAT_MIN_REVENUE = 300_000_000
const BEAT_MIN_MARKET_CAP = 1_000_000_000
// Insider clusters are kept for mid and large caps only (from 2 billion), where a cluster of purchases is a real signal rather than noise from micro-caps.
const clusterMoney = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)} milioni di dollari` : `${Math.round(v / 1_000)} mila dollari`)
const CLUSTER_MIN_MARKET_CAP = 2_000_000_000
const IPO_LOOKBACK_DAYS = 120
const IPO_MIN_VALUE = 200_000_000
const PEER_SOURCES = 6
const PEERS_EACH = 3

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export async function sourceCandidates(watchedSymbols: Set<string> = new Set()): Promise<CandidateSeed[]> {
  const seedMap = new Map<string, CandidateSeed>()

  function addSeed(seed: Omit<CandidateSeed, 'source'> & { source: string }) {
    const existing = seedMap.get(seed.symbol)
    if (existing) {
      if (!existing.source.includes(seed.source)) existing.source.push(seed.source)
      existing.seedPrice ??= seed.seedPrice
      existing.seedChangePct ??= seed.seedChangePct
      existing.congressScore ??= seed.congressScore
      existing.clusterBuyerCount ??= seed.clusterBuyerCount
      existing.congressInfo ??= seed.congressInfo
      existing.congressSellers ??= seed.congressSellers
      existing.event ??= seed.event
    } else seedMap.set(seed.symbol, { ...seed, source: [seed.source] })
  }
  const seed = (symbol: string, name: string, market: 'US' | 'IT', source: SeedSource, extra: Partial<Omit<CandidateSeed, 'source' | 'symbol' | 'name' | 'market'>> = {}) =>
    addSeed({ symbol, name, market, source, seedPrice: null, seedChangePct: null, congressScore: null, clusterBuyerCount: null, ...extra })
  const guard = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (err) {
      console.error(`Discovery: ${label} sourcing failed:`, err instanceof Error ? err.message : String(err))
    }
  }

  const today = tradingDay()
  await Promise.all([
    guard('congress', async () => {
      const raw = await getRecentCongressBuys()
      if (!raw || raw.length === 0) return
      const buys = await withMarketReturn(raw)
      const people = new Map<string, { member: string; chamber: string; state: string }>()
      for (const b of buys) if (!people.has(b.member)) people.set(b.member, { member: b.member, chamber: b.chamber, state: b.state })
      const [profiles, sellers] = await Promise.all([getMemberProfiles([...people.values()]), getRecentCongressSellers().catch(() => null)])
      const signals = rankSignals(buys, profiles, memberStats(buys), undefined, sellers ?? undefined)
      for (const s of signals) {
        seed(s.ticker, s.asset, 'US', 'congress', {
          congressScore: s.score,
          congressSellers: s.sellers,
          congressInfo: { members: s.members.length, trades: s.trades, totalLow: s.totalLow, totalHigh: s.totalHigh, reasons: s.reasons },
        })
      }
    }),
    guard('IT movers', async () => {
      for (const m of await getMarketBigMovers(10, 'it')) seed(m.symbol, m.name, 'IT', 'movers-it', { seedPrice: m.price, seedChangePct: m.changePct, event: `oggi si muove molto (${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(1)}%)` })
    }),
    guard('EDGAR Form 4 clusters', async () => {
      const clusters = await getForm4ClusterSeeds()
      if (clusters.length === 0) return
      const infos = await getQuoteInfo(clusters.map((c) => c.symbol))
      for (const c of clusters) {
        if ((infos.get(c.symbol)?.marketCap ?? 0) < CLUSTER_MIN_MARKET_CAP) continue
        seed(c.symbol, infos.get(c.symbol)?.name ?? c.name, 'US', 'edgar-form4-cluster', { clusterBuyerCount: c.buyerCount })
      }
    }),
    guard('earnings beats', async () => {
      const events = (await getEarningsFeed(addDays(today, -3), today)).filter((e) => (e.revenueEstimate ?? 0) >= BEAT_MIN_REVENUE && e.epsEstimate !== null && e.epsEstimate > 0)
      const beats = events
        .map((e) => ({ e, s: surprise(e.epsActual, e.epsEstimate) }))
        .filter((x) => x.s?.pct != null && x.s.pct >= MIN_EARNINGS_BEAT_PCT)
        .sort((a, b) => (b.e.revenueEstimate ?? 0) - (a.e.revenueEstimate ?? 0))
        .slice(0, 25)
      const infos = await getQuoteInfo(beats.map((b) => b.e.symbol))
      for (const { e, s } of beats) {
        const info = infos.get(e.symbol)
        if ((info?.marketCap ?? 0) < BEAT_MIN_MARKET_CAP) continue
        seed(e.symbol, info?.name ?? e.symbol, 'US', 'earnings-beat', { event: `ha battuto le attese sugli utili (+${s!.pct!.toFixed(0)}%)` })
      }
    }),
    guard('IPOs', async () => {
      const ipos = await getIpoCalendar(addDays(today, -IPO_LOOKBACK_DAYS), today)
      for (const i of ipos.filter((x) => x.symbol && x.status === 'priced' && (x.totalValue ?? 0) >= IPO_MIN_VALUE && /nasdaq|nyse/i.test(x.exchange ?? '')).slice(-10)) {
        seed(i.symbol!, i.name, 'US', 'ipo', { event: `quotato da poco (IPO del ${new Date(`${i.date}T00:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' })})` })
      }
    }),
    guard('peers', async () => {
      const mine = [...watchedSymbols].filter((s) => /^[A-Z.\-]+$/.test(s)).slice(0, PEER_SOURCES)
      const lists = await Promise.all(mine.map(async (s) => ({ s, peers: await getPeers(s).catch(() => [] as string[]) })))
      for (const { s, peers } of lists) {
        for (const p of peers.filter((x) => !watchedSymbols.has(x)).slice(0, PEERS_EACH)) seed(p, p, 'US', 'peer', { event: `è tra i concorrenti di ${s}, che segui` })
      }
    }),
  ])

  return [...seedMap.values()]
    .filter((s) => !watchedSymbols.has(s.symbol.toUpperCase()) || s.source.includes('congress'))
    .sort((a, b) => b.source.length - a.source.length || Math.abs(b.seedChangePct ?? 0) - Math.abs(a.seedChangePct ?? 0))
}

// Each source gets a fair share of the slots, so a long list of one kind (say, politicians) cannot crowd out the rest. Insider clusters sit outside that pool and are all kept.
export function selectForEnrichment(seeds: CandidateSeed[], maxUS = 14, maxIT = 6): CandidateSeed[] {
  // Cluster-only candidates are not capped: every one that passed the market-cap filter gets a slot, on top of the general pool.
  const generalCap = Math.max(maxUS - 4, 0)

  const us = seeds.filter((s) => s.market === 'US')
  const clusterOnly = us
    .filter((s) => s.source.length === 1 && s.source[0] === 'edgar-form4-cluster')
    .sort((a, b) => (b.clusterBuyerCount ?? 0) - (a.clusterBuyerCount ?? 0))
  const taken = new Set(clusterOnly.map((s) => s.symbol))

  const groups = new Map<string, CandidateSeed[]>()
  for (const s of us.filter((x) => !taken.has(x.symbol))) groups.set(s.source[0], [...(groups.get(s.source[0]) ?? []), s])
  const general: CandidateSeed[] = []
  const lists = [...groups.values()]
  for (let i = 0; general.length < generalCap && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && general.length < generalCap) general.push(l[i])
  }

  return [...general, ...clusterOnly, ...seeds.filter((s) => s.market === 'IT').slice(0, maxIT)]
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

const SPARK_POINTS = 63
const daysUntil = (date: string, today: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)

export interface EnrichedCandidate {
  score: CandidateScore
  partial: boolean
  price: number
  changePct: number
  marketCap: number | null
  spark: number[] | null
}

async function enrichAndScore(seed: CandidateSeed, info: QuoteInfo | undefined, today: string): Promise<EnrichedCandidate | null> {
  let price = seed.seedPrice ?? info?.price ?? null
  let changePct = seed.seedChangePct ?? info?.changePct ?? 0
  if (price === null) {
    try {
      const quote = await getQuote(seed.symbol)
      // 0 is what Finnhub answers for a symbol it does not know: treat it as no price.
      if (quote.currentPrice > 0) {
        price = quote.currentPrice
        changePct = quote.changePercent
      }
    } catch {
      price = null
    }
  }
  if (price === null) return null

  let metrics: Awaited<ReturnType<typeof getMetrics>> | null = null
  let partial = false
  try {
    metrics = await getMetrics(seed.symbol)
  } catch {
    partial = true
  }

  let insiderBuyerCount = 0
  let insiderSellerCount = 0
  let insiderKnown = false
  let clusterEvent: string | null = null
  let daysToEarnings: number | null = null
  if (seed.market === 'US') {
    const [insider, next] = await Promise.all([getInsiderData(seed.symbol).catch(() => null), getNextEarnings(seed.symbol).catch(() => null)])
    if (insider) {
      insiderKnown = true
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000
      const recent = insider.trades.filter((t) => new Date(t.date).getTime() >= since)
      insiderBuyerCount = new Set(recent.filter((t) => t.side === 'buy').map((t) => t.name)).size
      insiderSellerCount = new Set(recent.filter((t) => t.side === 'sell').map((t) => t.name)).size
      const cluster = buildCluster(insider.trades)
      if (cluster && !seed.event) clusterEvent = `${cluster.insiders} insider hanno comprato per ${clusterMoney(cluster.total)} in pochi giorni, il più grosso è ${cluster.lead.role ?? cluster.lead.name}`
    } else partial = true
    if (next) daysToEarnings = daysUntil(next.date, today)
  }

  const bars = await getDailyBars(seed.symbol).catch(() => [])
  const spark = bars.length >= 10 ? bars.slice(-SPARK_POINTS).map((b) => Math.round(b.close * 100) / 100) : null

  const score = scoreCandidate(
    {
      market: seed.market,
      price,
      changePct,
      week52High: metrics?.week52High ?? null,
      week52Low: metrics?.week52Low ?? null,
      roe: metrics?.roe ?? null,
      pegRatio: metrics?.pegRatio ?? null,
      debtToEquity: metrics?.debtToEquity ?? null,
      netMargin: metrics?.netMargin ?? null,
      epsGrowth5Y: metrics?.epsGrowth5Y ?? null,
      congressSignalScore: seed.congressScore,
      congressInfo: seed.congressInfo,
      congressSellers: seed.congressSellers,
      insiderBuyerCount,
      insiderSellerCount,
      insiderKnown,
      daysToEarnings,
    },
    seed.event ?? clusterEvent
  )
  return { score, partial, price, changePct, marketCap: info?.marketCap ?? null, spark }
}

export interface ScanProgress {
  step: string
  done?: number
  total?: number
}

const HISTORY_KEEP_DAYS = 180

export async function runDiscoveryScan(onProgress: (p: ScanProgress) => void = () => {}): Promise<{ scannedAt: Date; candidates: number }> {
  const scannedAt = new Date()
  const today = tradingDay(scannedAt)
  const watched = await prisma.stock.findMany({ select: { symbol: true } })
  const watchedSymbols = new Set(watched.map((w) => w.symbol.toUpperCase()))

  onProgress({ step: 'Raccolgo i titoli da politici, insider, utili, IPO e concorrenti' })
  const seeds = await sourceCandidates(watchedSymbols)
  const selected = selectForEnrichment(seeds)
  const infos = await getQuoteInfo(selected.map((s) => s.symbol)).catch(() => new Map<string, QuoteInfo>())

  const results: Array<{ seed: CandidateSeed } & EnrichedCandidate> = []
  let done = 0
  onProgress({ step: 'Leggo conti, insider e prezzi', done, total: selected.length })
  await runWithConcurrency(selected, 5, async (seed) => {
    const enriched = await enrichAndScore(seed, infos.get(seed.symbol), today)
    if (enriched) results.push({ seed, ...enriched })
    onProgress({ step: 'Leggo conti, insider e prezzi', done: ++done, total: selected.length })
  })

  if (results.length === 0) return { scannedAt, candidates: 0 }

  onProgress({ step: 'Salvo i candidati' })
  const previous = new Map((await prisma.discoveredCandidate.findMany({ where: { symbol: { in: results.map((r) => r.seed.symbol) } }, select: { symbol: true, score: true } })).map((c) => [c.symbol, c.score]))
  for (const { seed, score, partial, price, changePct, marketCap, spark } of results) {
    const data = {
      name: seed.name, market: seed.market,
      score: score.score, momentumScore: score.momentumScore, fundamentalsScore: score.fundamentalsScore, insiderScore: score.insiderScore,
      reason: score.reason, source: seed.source.join(','), partial, scannedAt,
      price, changePct, marketCap, flags: score.flags, spark: spark ?? undefined,
    }
    await prisma.discoveredCandidate.upsert({
      where: { symbol: seed.symbol },
      create: { symbol: seed.symbol, firstSeenAt: scannedAt, ...data },
      update: { ...data, prevScore: previous.get(seed.symbol) ?? null, aiVerdict: null, aiNote: null, aiCheckedAt: null },
    })
  }
  await prisma.discoveryHistory.createMany({ data: results.map((r) => ({ symbol: r.seed.symbol, scannedAt, score: r.score.score, price: r.price })) })
  await prisma.discoveryHistory.deleteMany({ where: { scannedAt: { lt: new Date(scannedAt.getTime() - HISTORY_KEEP_DAYS * 86_400_000) } } })

  onProgress({ step: 'Faccio rileggere i migliori all’IA' })
  await reviewTopCandidates().catch((err) => console.error('Candidate review failed:', err instanceof Error ? err.message : err))

  return { scannedAt, candidates: results.length }
}

// Whole hours since a date, for "last scan N hours ago" without calling the clock inside a component.
export function hoursSince(date: Date, now: number = Date.now()): number {
  return Math.floor((now - date.getTime()) / 3_600_000)
}
