import { reviewTopCandidates } from './candidate-review'
import { getRecentCongressBuys } from './congress'
import { memberStats } from './politician-profiles'
import { rankSignals } from './congress-signals'
import { getMarketBigMovers } from './market'
import { prisma } from './db'
import { getQuote, getMetrics } from './finnhub'
import { getInsiderData } from './insider-data'
import { getForm4ClusterSeeds } from './edgar-form4-feed'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number) => Math.round(v)
const formatUsd = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} mln $` : `${Math.round(n / 1_000)}k $`)

export interface CongressInfo {
  members: number
  trades: number
  totalLow: number
  totalHigh: number
  reasons: string[]
}

export interface ScoreInput {
  price: number
  week52High: number | null
  week52Low: number | null
  changePct: number
  pegRatio: number | null
  roe: number | null
  debtToEquity: number | null
  congressSignalScore: number | null
  insiderBuyerCount: number
  congressInfo?: CongressInfo | null
  market: 'US' | 'IT'
}

export interface CandidateScore {
  momentumScore: number
  fundamentalsScore: number
  insiderScore: number
  score: number
  reason: string
}

function momentumScoreOf(input: ScoreInput): number {
  const movePoints = clamp(Math.abs(input.changePct) / 30 * 100, 0, 100)
  if (input.week52High === null || input.week52Low === null || input.week52High <= input.week52Low) {
    return round(movePoints)
  }
  const rangePoints = clamp((input.price - input.week52Low) / (input.week52High - input.week52Low), 0, 1) * 100
  return round((rangePoints + movePoints) / 2)
}

function fundamentalsScoreOf(input: ScoreInput): number {
  const pegPoints = input.pegRatio === null || input.pegRatio <= 0 ? 0 : input.pegRatio <= 1 ? 40 : input.pegRatio <= 2 ? 20 : 0
  const roePoints = input.roe === null ? 0 : input.roe > 15 ? 40 : input.roe > 0 ? 20 : 0
  const debtPoints = input.debtToEquity === null ? 0 : input.debtToEquity < 1 ? 20 : input.debtToEquity < 2 ? 10 : 0
  return pegPoints + roePoints + debtPoints
}

function insiderScoreOf(input: ScoreInput): number {
  if (input.market === 'IT') return 0
  const congressPoints = input.congressSignalScore === null ? 0 : clamp(input.congressSignalScore / 12 * 100, 0, 100)
  const insiderPoints = clamp(input.insiderBuyerCount * 25, 0, 100)
  return round(Math.max(congressPoints, insiderPoints))
}

function buildReason(input: ScoreInput, s: { momentumScore: number; fundamentalsScore: number; insiderScore: number }): string {
  const parts: string[] = []
  if (s.momentumScore >= 60) {
    const sign = input.changePct >= 0 ? '+' : ''
    parts.push(`oggi si muove molto (${sign}${input.changePct.toFixed(1)}%)`)
  }
  if (s.fundamentalsScore >= 60) {
    const strong: string[] = []
    if (input.roe !== null && input.roe > 15) strong.push(`rende bene (ROE ${input.roe.toFixed(0)}%)`)
    if (input.debtToEquity !== null && input.debtToEquity < 1) strong.push('ha poco debito')
    const pricey = input.pegRatio !== null && input.pegRatio > 2 ? ', anche se il prezzo è alto rispetto alla crescita' : ''
    parts.push(`l'azienda ${strong.length ? strong.join(' e ') : 'ha conti discreti'}${pricey}`)
  }
  if (input.market === 'US' && s.insiderScore >= 50) {
    parts.push(input.congressSignalScore !== null ? 'politici USA hanno comprato di recente' : 'dirigenti dell\'azienda hanno comprato azioni di recente')
  }
  if (parts.length === 0) {
    parts.push('segnali deboli: è qui solo perché tra i titoli più mossi del giorno')
  }
  let headline = parts.join(', ')
  headline = headline.charAt(0).toUpperCase() + headline.slice(1) + '.'

  const sign = input.changePct >= 0 ? '+' : ''
  let range = ''
  if (input.week52High !== null && input.week52Low !== null && input.week52High > input.week52Low) {
    const pos = clamp((input.price - input.week52Low) / (input.week52High - input.week52Low), 0, 1) * 100
    range = ` Il prezzo è al ${pos.toFixed(0)}% tra il minimo e il massimo degli ultimi 12 mesi.`
  }
  const momentum = `Oggi il titolo fa ${sign}${input.changePct.toFixed(1)}%.${range} Più si muove e più è vicino ai massimi, più sale il voto.`

  const pegPts = input.pegRatio === null || input.pegRatio <= 0 ? 0 : input.pegRatio <= 1 ? 40 : input.pegRatio <= 2 ? 20 : 0
  const roePts = input.roe === null ? 0 : input.roe > 15 ? 40 : input.roe > 0 ? 20 : 0
  const debtPts = input.debtToEquity === null ? 0 : input.debtToEquity < 1 ? 20 : input.debtToEquity < 2 ? 10 : 0
  const fundamentals = [
    input.pegRatio !== null && input.pegRatio > 0 ? `PEG ${input.pegRatio.toFixed(1)} (prezzo rispetto alla crescita; sotto 1 è ottimo, sotto 2 buono): ${pegPts}/40 punti.` : 'PEG non disponibile: 0/40 punti.',
    input.roe !== null ? `ROE ${input.roe.toFixed(0)}% (quanto rende il capitale; sopra 15% è buono): ${roePts}/40 punti.` : 'ROE non disponibile: 0/40 punti.',
    input.debtToEquity !== null ? `Debito/patrimonio ${input.debtToEquity.toFixed(1)} (sotto 1 è basso): ${debtPts}/20 punti.` : 'Debito non disponibile: 0/20 punti.',
  ].join(' ')

  const lines = [headline, momentum, fundamentals]
  if (input.market === 'US') {
    const bits: string[] = []
    const c = input.congressInfo
    let congressText = 'Nessun acquisto recente di politici USA.'
    if (c) {
      const who = c.members === 1 ? '1 politico ha' : `${c.members} politici hanno`
      const amount = c.totalHigh > 0 ? ` per ${formatUsd(c.totalLow)}–${formatUsd(c.totalHigh)}` : ''
      const why = c.reasons.length ? ` (${c.reasons.join(', ')})` : ''
      congressText = `${who} comprato${amount} in ${c.trades} ${c.trades === 1 ? 'operazione' : 'operazioni'}${why}.`
    } else if (input.congressSignalScore !== null) {
      congressText = 'Acquisti recenti da parte di politici USA.'
    }
    bits.push(congressText)
    bits.push(
      input.insiderBuyerCount > 0
        ? `${input.insiderBuyerCount} ${input.insiderBuyerCount === 1 ? 'dirigente ha comprato' : 'dirigenti hanno comprato'} azioni negli ultimi 30 giorni.`
        : 'Nessun acquisto di dirigenti negli ultimi 30 giorni.'
    )
    bits.push('Il voto prende il più alto tra i due segnali: gli acquisti dei politici contano anche se i dirigenti non comprano.')
    lines.push(bits.join(' '))
  } else {
    lines.push('Per i titoli italiani non ci sono dati su acquisti di dirigenti e politici, quindi il punteggio usa solo Andamento e Conti.')
  }
  return lines.join('\n')
}

export function scoreCandidate(input: ScoreInput): CandidateScore {
  const momentumScore = momentumScoreOf(input)
  const fundamentalsScore = fundamentalsScoreOf(input)
  const insiderScore = insiderScoreOf(input)
  const score = round(
    input.market === 'IT'
      ? (momentumScore + fundamentalsScore) / 2
      : (momentumScore + fundamentalsScore + insiderScore) / 3
  )
  const reason = buildReason(input, { momentumScore, fundamentalsScore, insiderScore })
  return { momentumScore, fundamentalsScore, insiderScore, score, reason }
}

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
}

export async function sourceCandidates(excludeSymbols: Set<string>): Promise<CandidateSeed[]> {
  const seedMap = new Map<string, CandidateSeed>()

  function addSeed(symbol: string, name: string, market: 'US' | 'IT', source: string, seedPrice: number | null, seedChangePct: number | null, congressScore: number | null, clusterBuyerCount: number | null = null, congressInfo: CongressInfo | null = null) {
    const existing = seedMap.get(symbol)
    if (existing) {
      if (!existing.source.includes(source)) existing.source.push(source)
      if (existing.seedPrice === null) existing.seedPrice = seedPrice
      if (existing.seedChangePct === null) existing.seedChangePct = seedChangePct
      if (existing.congressScore === null) existing.congressScore = congressScore
      if (existing.clusterBuyerCount === null) existing.clusterBuyerCount = clusterBuyerCount
      if (!existing.congressInfo) existing.congressInfo = congressInfo
    } else {
      seedMap.set(symbol, { symbol, name, market, source: [source], seedPrice, seedChangePct, congressScore, clusterBuyerCount, congressInfo })
    }
  }

  try {
    const buys = await getRecentCongressBuys()
    if (buys && buys.length > 0) {
      const stats = memberStats(buys)
      const signals = rankSignals(buys, new Map(), stats)
      for (const s of signals) addSeed(s.ticker, s.asset, 'US', 'congress', null, null, s.score, null, { members: s.members.length, trades: s.trades, totalLow: s.totalLow, totalHigh: s.totalHigh, reasons: s.reasons })
    }
  } catch (err) {
    console.error('Discovery: congress sourcing failed:', err instanceof Error ? err.message : String(err))
  }

  try {
    const usMovers = await getMarketBigMovers(15, 'us')
    for (const m of usMovers) addSeed(m.symbol, m.name, 'US', 'yahoo-movers-us', m.price, m.changePct, null)
  } catch (err) {
    console.error('Discovery: US movers sourcing failed:', err instanceof Error ? err.message : String(err))
  }

  try {
    const itMovers = await getMarketBigMovers(15, 'it')
    for (const m of itMovers) addSeed(m.symbol, m.name, 'IT', 'yahoo-movers-it', m.price, m.changePct, null)
  } catch (err) {
    console.error('Discovery: IT movers sourcing failed:', err instanceof Error ? err.message : String(err))
  }

  try {
    const clusters = await getForm4ClusterSeeds()
    for (const c of clusters) addSeed(c.symbol, c.name, 'US', 'edgar-form4-cluster', null, null, null, c.buyerCount)
  } catch (err) {
    console.error('Discovery: EDGAR Form4 cluster sourcing failed:', err instanceof Error ? err.message : String(err))
  }

  return [...seedMap.values()]
    .filter((s) => !excludeSymbols.has(s.symbol.toUpperCase()))
    .sort((a, b) => b.source.length - a.source.length || Math.abs(b.seedChangePct ?? 0) - Math.abs(a.seedChangePct ?? 0))
}

export function selectForEnrichment(seeds: CandidateSeed[], maxUS = 14, maxIT = 6): CandidateSeed[] {
  const clusterReserved = Math.min(4, maxUS)
  const generalCap = maxUS - clusterReserved

  const us = seeds.filter((s) => s.market === 'US')
  const clusterOnly = us
    .filter((s) => s.source.length === 1 && s.source[0] === 'edgar-form4-cluster')
    .sort((a, b) => (b.clusterBuyerCount ?? 0) - (a.clusterBuyerCount ?? 0))
    .slice(0, clusterReserved)
  const clusterOnlySymbols = new Set(clusterOnly.map((s) => s.symbol))
  const general = us.filter((s) => !clusterOnlySymbols.has(s.symbol)).slice(0, generalCap)

  const it = seeds.filter((s) => s.market === 'IT').slice(0, maxIT)

  return [...general, ...clusterOnly, ...it]
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

async function enrichAndScore(seed: CandidateSeed): Promise<{ score: CandidateScore; partial: boolean } | null> {
  let price = seed.seedPrice
  let changePct = seed.seedChangePct ?? 0

  if (price === null) {
    try {
      const quote = await getQuote(seed.symbol)
      price = quote.currentPrice
      changePct = quote.changePercent
    } catch {
      price = null
    }
  }

  let metrics: Awaited<ReturnType<typeof getMetrics>> | null = null
  let metricsFailed = false
  try {
    metrics = await getMetrics(seed.symbol)
  } catch {
    metricsFailed = true
  }

  if (price === null) return null

  let insiderBuyerCount = 0
  let insiderFailed = false
  if (seed.market === 'US') {
    try {
      const insider = await getInsiderData(seed.symbol)
      if (insider) {
        const since = Date.now() - 30 * 24 * 60 * 60 * 1000
        insiderBuyerCount = new Set(
          insider.trades.filter((t) => t.side === 'buy' && new Date(t.date).getTime() >= since).map((t) => t.name)
        ).size
      } else {
        insiderFailed = true
      }
    } catch {
      insiderFailed = true
    }
  }

  const score = scoreCandidate({
    price,
    week52High: metrics?.week52High ?? null,
    week52Low: metrics?.week52Low ?? null,
    changePct,
    pegRatio: metrics?.pegRatio ?? null,
    roe: metrics?.roe ?? null,
    debtToEquity: metrics?.debtToEquity ?? null,
    congressSignalScore: seed.congressScore,
    insiderBuyerCount,
    congressInfo: seed.congressInfo,
    market: seed.market,
  })

  return { score, partial: metricsFailed || insiderFailed }
}

export async function runDiscoveryScan(): Promise<{ scannedAt: Date; candidates: number }> {
  const scannedAt = new Date()
  const watched = await prisma.stock.findMany({ select: { symbol: true } })
  const excludeSymbols = new Set(watched.map((w) => w.symbol.toUpperCase()))

  const seeds = await sourceCandidates(excludeSymbols)
  const selected = selectForEnrichment(seeds)

  const results: Array<{ seed: CandidateSeed; score: CandidateScore; partial: boolean }> = []
  await runWithConcurrency(selected, 5, async (seed) => {
    const enriched = await enrichAndScore(seed)
    if (enriched) results.push({ seed, score: enriched.score, partial: enriched.partial })
  })

  if (results.length === 0) return { scannedAt, candidates: 0 }

  for (const { seed, score, partial } of results) {
    await prisma.discoveredCandidate.upsert({
      where: { symbol: seed.symbol },
      create: {
        symbol: seed.symbol, name: seed.name, market: seed.market,
        score: score.score, momentumScore: score.momentumScore, fundamentalsScore: score.fundamentalsScore, insiderScore: score.insiderScore,
        reason: score.reason, source: seed.source.join(','), partial, scannedAt,
      },
      update: {
        name: seed.name, market: seed.market,
        score: score.score, momentumScore: score.momentumScore, fundamentalsScore: score.fundamentalsScore, insiderScore: score.insiderScore,
        reason: score.reason, source: seed.source.join(','), partial, scannedAt, dismissedAt: null,
        aiVerdict: null, aiNote: null, aiCheckedAt: null,
      },
    })
  }

  await reviewTopCandidates().catch((err) => console.error('Candidate review failed:', err instanceof Error ? err.message : err))

  return { scannedAt, candidates: results.length }
}
