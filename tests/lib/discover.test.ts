import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as congress from '@/lib/congress'
import * as politicianProfiles from '@/lib/politician-profiles'
import * as congressSignals from '@/lib/congress-signals'
import * as benchmark from '@/lib/congress-benchmark'
import * as market from '@/lib/market'
import * as earnings from '@/lib/earnings'
import * as quoteInfo from '@/lib/quote-info'
import * as history from '@/lib/history'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import * as insiderData from '@/lib/insider-data'
import * as edgarForm4Feed from '@/lib/edgar-form4-feed'
import { resetDb } from '../helpers/db'
import { scoreCandidate, qualityScoreOf, timingScoreOf, peopleScoreOf, sourceCandidates, selectForEnrichment, runDiscoveryScan, hoursSince, UNKNOWN, type ScoreInput, type CandidateSeed } from '@/lib/discover'

function baseInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    market: 'US', price: 100, changePct: 0, week52High: null, week52Low: null,
    roe: null, pegRatio: null, debtToEquity: null, netMargin: null, epsGrowth5Y: null,
    congressSignalScore: null, insiderBuyerCount: 0, ...overrides,
  }
}

describe('qualityScoreOf', () => {
  it('averages the graded ratios that are available', () => {
    // ROE 20 -> 100, debt 0.2 -> 100, margin 12 -> 70
    expect(qualityScoreOf(baseInput({ roe: 20, debtToEquity: 0.2, netMargin: 12 }))).toBe(90)
  })
  it('is unknown with fewer than two ratios, never a zero', () => {
    expect(qualityScoreOf(baseInput({ roe: 20 }))).toBe(UNKNOWN)
    expect(qualityScoreOf(baseInput())).toBe(UNKNOWN)
  })
  it('gives no credit to negative equity and ignores a negative PEG', () => {
    expect(qualityScoreOf(baseInput({ debtToEquity: -2, roe: 20, pegRatio: -1 }))).toBe(50)
  })
})

describe('timingScoreOf', () => {
  it('prefers a price in the lower-middle of its yearly range', () => {
    const at = (price: number) => timingScoreOf(baseInput({ price, week52Low: 100, week52High: 200 }))
    expect(at(140)).toBe(90)
    expect(at(185)).toBe(70)
    expect(at(110)).toBe(30)
  })
  it('does not reward a big rise: it lowers the score', () => {
    expect(timingScoreOf(baseInput({ changePct: 30 }))).toBeLessThan(timingScoreOf(baseInput({ changePct: 2 })))
    expect(timingScoreOf(baseInput({ changePct: 30 }))).toBe(35)
  })
  it('lowers it when earnings are close', () => {
    expect(timingScoreOf(baseInput({ daysToEarnings: 2 }))).toBe(40)
    expect(timingScoreOf(baseInput({ daysToEarnings: 6 }))).toBe(50)
    expect(timingScoreOf(baseInput({ daysToEarnings: 30 }))).toBe(60)
  })
})

describe('peopleScoreOf', () => {
  it('has no insider data for Italy', () => {
    expect(peopleScoreOf(baseInput({ market: 'IT', congressSignalScore: 12 }))).toBe(UNKNOWN)
  })
  it('takes the stronger of politicians and insiders, and insider sales weigh against buys', () => {
    expect(peopleScoreOf(baseInput({ congressSignalScore: 6, insiderKnown: true }))).toBe(50)
    expect(peopleScoreOf(baseInput({ insiderBuyerCount: 3, insiderSellerCount: 2, insiderKnown: true }))).toBe(55)
  })
  it('is unknown when the insider data could not be read and nobody else signals', () => {
    expect(peopleScoreOf(baseInput({ insiderKnown: false }))).toBe(UNKNOWN)
  })
  it('is a real zero when the data was read and nobody is buying', () => {
    expect(peopleScoreOf(baseInput({ insiderKnown: true }))).toBe(0)
  })
})

describe('scoreCandidate', () => {
  it('averages the pillars that are known', () => {
    const r = scoreCandidate(baseInput({ roe: 20, debtToEquity: 0.2, netMargin: 12, congressSignalScore: 12, insiderKnown: true, price: 140, week52Low: 100, week52High: 200 }))
    expect(r).toMatchObject({ insiderScore: 100, fundamentalsScore: 90, momentumScore: 90, score: 93 })
  })
  it('leaves an unknown pillar out of the total instead of counting zero', () => {
    const r = scoreCandidate(baseInput({ market: 'IT', roe: 20, debtToEquity: 0.2, netMargin: 12, price: 140, week52Low: 100, week52High: 200 }))
    expect(r.insiderScore).toBe(UNKNOWN)
    expect(r.score).toBe(90)
    expect(r.reason).toContain('titoli italiani')
  })
  it('raises flags for what a reader should know before looking', () => {
    const r = scoreCandidate(baseInput({ changePct: 18, daysToEarnings: 2, insiderSellerCount: 3, insiderKnown: true, congressSellers: 1 }))
    expect(r.flags).toEqual(['Trimestrale tra 2 giorni', 'Già salito molto oggi', 'I dirigenti stanno vendendo', 'Venduto anche da altri politici', 'Conti non disponibili'])
  })
  it('opens with the event that brought the stock here', () => {
    const r = scoreCandidate(baseInput({ insiderKnown: true }), 'ha battuto le attese sugli utili (+25%)')
    expect(r.reason.split('\n')[0]).toBe('Ha battuto le attese sugli utili (+25%).')
  })
  it('keeps detail lines in the order of the pillars: people, quality, timing', () => {
    const lines = scoreCandidate(baseInput({ insiderKnown: true, roe: 20, netMargin: 12 })).reason.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain('politici')
    expect(lines[2]).toContain('ROE')
    expect(lines[3]).toContain('Oggi il titolo')
  })
})

const emptySources = () => {
  vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
  vi.spyOn(congress, 'getRecentCongressSellers').mockResolvedValue(new Map())
  vi.spyOn(benchmark, 'withMarketReturn').mockImplementation(async (b) => b)
  vi.spyOn(politicianProfiles, 'getMemberProfiles').mockResolvedValue(new Map())
  vi.spyOn(market, 'getMarketBigMovers').mockResolvedValue([])
  vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockResolvedValue([])
  vi.spyOn(earnings, 'getEarningsFeed').mockResolvedValue([])
  vi.spyOn(finnhub, 'getIpoCalendar').mockResolvedValue([])
  vi.spyOn(finnhub, 'getPeers').mockResolvedValue([])
  vi.spyOn(quoteInfo, 'getQuoteInfo').mockResolvedValue(new Map())
}

describe('sourceCandidates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    emptySources()
  })

  it('combines congress buys and Italian movers into one deduped list, with the US movers gone', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([
      { member: 'Jane Doe', chamber: 'house', state: 'CA', side: 'buy', amountLow: 50_000, amountHigh: 100_000, date: '2026-11-01', disclosedAt: '2026-11-05', ticker: 'NVDA', asset: 'Nvidia Corp', perfPct: null },
    ])
    vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([
      { ticker: 'NVDA', asset: 'Nvidia Corp', members: ['Jane Doe'], trades: 1, totalLow: 50_000, totalHigh: 100_000, firstDate: '2026-11-01', lastDisclosedAt: '2026-11-05', avgPerfPct: null, timing: 'unknown', avgExcessPct: null, sellers: 2, maxLagDays: 0, score: 8, reasons: [] },
    ])
    const movers = vi.spyOn(market, 'getMarketBigMovers').mockResolvedValue([{ symbol: 'ENI.MI', name: 'Eni', changePct: -16, price: 14, marketCap: null, volume: null, relVolume: null, exchange: null }])

    const seeds = await sourceCandidates()

    expect(movers).toHaveBeenCalledTimes(1)
    expect(movers).toHaveBeenCalledWith(10, 'it')
    expect(seeds.map((s) => s.symbol).sort()).toEqual(['ENI.MI', 'NVDA'])
    expect(seeds.find((s) => s.symbol === 'NVDA')).toMatchObject({ market: 'US', source: ['congress'], congressScore: 8, congressSellers: 2 })
    expect(seeds.find((s) => s.symbol === 'ENI.MI')).toMatchObject({ market: 'IT', congressScore: null })
  })

  it('adds a cluster-only seed from EDGAR Form 4 and merges it onto a symbol found elsewhere', async () => {
    vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockResolvedValue([{ symbol: 'ACME', name: 'Acme Corp', buyerCount: 3 }, { symbol: 'IPOX', name: 'Ipo X', buyerCount: 2 }])
    vi.spyOn(finnhub, 'getIpoCalendar').mockResolvedValue([{ date: '2026-10-20', name: 'Ipo X', symbol: 'IPOX', exchange: 'NASDAQ Global', price: '20', shares: 1, totalValue: 500_000_000, status: 'priced' }])

    const seeds = await sourceCandidates()

    expect(seeds.find((s) => s.symbol === 'ACME')).toMatchObject({ source: ['edgar-form4-cluster'], clusterBuyerCount: 3 })
    const ipo = seeds.find((s) => s.symbol === 'IPOX')!
    expect(ipo.source.sort()).toEqual(['edgar-form4-cluster', 'ipo'])
    expect(ipo.event).toContain('IPO')
  })

  it('keeps recent IPOs only when priced, large and listed on a US exchange', async () => {
    const ipo = (symbol: string, over = {}) => ({ date: '2026-10-20', name: symbol, symbol, exchange: 'NYSE', price: '20', shares: 1, totalValue: 500_000_000, status: 'priced', ...over })
    vi.spyOn(finnhub, 'getIpoCalendar').mockResolvedValue([ipo('GOOD'), ipo('SMALL', { totalValue: 1_000_000 }), ipo('EXPECTED', { status: 'expected' }), ipo('FOREIGN', { exchange: 'TSE' })])
    expect((await sourceCandidates()).map((s) => s.symbol)).toEqual(['GOOD'])
  })

  it('finds companies that beat earnings estimates by a lot and are not small', async () => {
    const ev = (symbol: string, epsActual: number) => ({ symbol, date: '2026-11-16', hour: 'amc', epsEstimate: 1, epsActual, revenueEstimate: 2e9, revenueActual: null })
    vi.spyOn(earnings, 'getEarningsFeed').mockResolvedValue([ev('BEAT', 1.3), ev('INLINE', 1.05), ev('TINY', 1.5)])
    vi.spyOn(quoteInfo, 'getQuoteInfo').mockResolvedValue(
      new Map([
        ['BEAT', { name: 'Beat Inc', marketCap: 5e9, price: 10, changePct: 3, time: null }],
        ['TINY', { name: 'Tiny Inc', marketCap: 5e7, price: 10, changePct: 3, time: null }],
      ])
    )
    const seeds = await sourceCandidates()
    expect(seeds.map((s) => s.symbol)).toEqual(['BEAT'])
    expect(seeds[0]).toMatchObject({ name: 'Beat Inc', source: ['earnings-beat'] })
    expect(seeds[0].event).toBe('ha battuto le attese sugli utili (+30%)')
  })

  it('suggests peers of what the user follows, and never what is already followed', async () => {
    vi.spyOn(finnhub, 'getPeers').mockImplementation(async (s) => (s === 'AAPL' ? ['MSFT', 'DELL', 'HPQ', 'HPE', 'AAPL'] : []))
    const seeds = await sourceCandidates(new Set(['AAPL', 'DELL']))
    expect(seeds.map((s) => s.symbol)).toEqual(['MSFT', 'HPQ', 'HPE'])
    expect(seeds[0]).toMatchObject({ source: ['peer'], event: 'è tra i concorrenti di AAPL, che segui' })
  })

  it('does not let one failing source block the others', async () => {
    vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockRejectedValue(new Error('SEC down'))
    vi.spyOn(market, 'getMarketBigMovers').mockResolvedValue([{ symbol: 'ENI.MI', name: 'Eni', changePct: 12, price: 14, marketCap: null, volume: null, relVolume: null, exchange: null }])
    expect((await sourceCandidates()).map((s) => s.symbol)).toEqual(['ENI.MI'])
  })
})

describe('selectForEnrichment', () => {
  const seed = (symbol: string, market: 'US' | 'IT', source = 'congress'): CandidateSeed => ({ symbol, name: symbol, market, source: [source], seedPrice: null, seedChangePct: null, congressScore: null, clusterBuyerCount: null })
  const cluster = (symbol: string, n: number): CandidateSeed => ({ ...seed(symbol, 'US', 'edgar-form4-cluster'), clusterBuyerCount: n })

  it('caps the general US pool at 10 and Italy at 6', () => {
    const seeds = [...Array(20)].map((_, i) => seed(`US${i}`, 'US')).concat([...Array(10)].map((_, i) => seed(`IT${i}`, 'IT', 'movers-it')))
    const out = selectForEnrichment(seeds)
    expect(out.filter((s) => s.market === 'US')).toHaveLength(10)
    expect(out.filter((s) => s.market === 'IT')).toHaveLength(6)
  })

  it('shares the slots among sources instead of letting the first one fill them', () => {
    const seeds = [...Array(20)].map((_, i) => seed(`P${i}`, 'US', 'congress')).concat([seed('E1', 'US', 'earnings-beat'), seed('I1', 'US', 'ipo'), seed('K1', 'US', 'peer')])
    const symbols = selectForEnrichment(seeds).map((s) => s.symbol)
    expect(symbols).toEqual(expect.arrayContaining(['E1', 'I1', 'K1']))
    expect(symbols).toHaveLength(10)
  })

  it('reserves up to 4 slots for cluster-only candidates, best buyer count first', () => {
    const seeds = [...Array(20)].map((_, i) => seed(`P${i}`, 'US')).concat([cluster('LOW', 2), cluster('H1', 9), cluster('H2', 8), cluster('H3', 7), cluster('H4', 6)])
    const out = selectForEnrichment(seeds)
    expect(out.map((s) => s.symbol)).toEqual(expect.arrayContaining(['H1', 'H2', 'H3', 'H4']))
    expect(out.filter((s) => s.market === 'US')).toHaveLength(14)
  })

  it('does not hand unused reserved slots to the other sources', () => {
    const out = selectForEnrichment([...[...Array(20)].map((_, i) => seed(`P${i}`, 'US')), cluster('C1', 5)])
    expect(out.filter((s) => s.market === 'US')).toHaveLength(11)
  })
})

describe('runDiscoveryScan', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
    emptySources()
    vi.spyOn(history, 'getDailyBars').mockResolvedValue([])
    vi.spyOn(finnhub, 'getNextEarnings').mockResolvedValue(null)
  })

  const metrics = { peRatio: 28, week52High: 420, week52Low: 300, pegRatio: 1.2, roe: 30, netMargin: 25, debtToEquity: 0.5, dividendYield: 0.8, payoutRatio: 20, relativePerf13W: 5, epsTTM: 10, epsGrowth5Y: 15, bookValuePerShare: 20, cashFlowPerShare: 12 }
  const withCluster = () => {
    vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockResolvedValue([{ symbol: 'MSFT', name: 'Microsoft', buyerCount: 2 }])
    vi.spyOn(quoteInfo, 'getQuoteInfo').mockResolvedValue(new Map([['MSFT', { name: 'Microsoft', marketCap: 3e12, price: 400, changePct: 1.5, time: null }]]))
    vi.spyOn(insiderData, 'getInsiderData').mockResolvedValue({ trades: [], sentiment: [] })
  }

  it('stores a scored candidate with a snapshot, a history row and a first-seen date', async () => {
    withCluster()
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(metrics)
    vi.spyOn(history, 'getDailyBars').mockResolvedValue([...Array(30)].map((_, i) => ({ t: i * 86_400_000, high: 1, low: 1, close: 100 + i, volume: 1 })))

    const result = await runDiscoveryScan()

    expect(result.candidates).toBe(1)
    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    expect(stored).toMatchObject({ market: 'US', partial: false, price: 400, changePct: 1.5, marketCap: 3e12, prevScore: null })
    expect(stored?.scannedAt).toEqual(result.scannedAt)
    expect(stored?.firstSeenAt).toEqual(result.scannedAt)
    expect((stored?.spark as number[]).length).toBe(30)
    const rows = await prisma.discoveryHistory.findMany({ where: { symbol: 'MSFT' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ price: 400, score: stored?.score })
  })

  it('keeps the first-seen date and remembers the previous score on the next scan', async () => {
    withCluster()
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(metrics)
    const first = await runDiscoveryScan()
    const before = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({ ...metrics, roe: -5, netMargin: -2, epsGrowth5Y: -3 })
    const second = await runDiscoveryScan()
    const after = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    expect(after?.firstSeenAt).toEqual(first.scannedAt)
    expect(after?.scannedAt).toEqual(second.scannedAt)
    expect(after?.prevScore).toBe(before?.score)
    expect(after!.score).toBeLessThan(before!.score)
    expect(await prisma.discoveryHistory.count({ where: { symbol: 'MSFT' } })).toBe(2)
  })

  it('flags a candidate as partial when getMetrics fails, but keeps it', async () => {
    withCluster()
    vi.spyOn(finnhub, 'getMetrics').mockRejectedValue(new Error('rate limited'))
    expect((await runDiscoveryScan()).candidates).toBe(1)
    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    expect(stored?.partial).toBe(true)
    expect(stored?.fundamentalsScore).toBe(UNKNOWN)
    expect(stored?.flags).toContain('Conti non disponibili')
  })

  it('does not suggest what is already in a watchlist, except a politicians pick', async () => {
    withCluster()
    await prisma.stock.create({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(metrics)
    expect((await runDiscoveryScan()).candidates).toBe(0)
  })

  it('reports progress step by step', async () => {
    withCluster()
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(metrics)
    const steps: string[] = []
    await runDiscoveryScan((p) => steps.push(p.step))
    expect(steps[0]).toContain('Raccolgo')
    expect(steps).toContain('Salvo i candidati')
  })

  it('returns zero candidates without touching the table when nothing could be priced', async () => {
    vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockResolvedValue([{ symbol: 'ZZZZ', name: 'Zed', buyerCount: 2 }])
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({ currentPrice: 0, changePercent: 0, high: 0, low: 0, open: 0, previousClose: 0 })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(metrics)
    expect((await runDiscoveryScan()).candidates).toBe(0)
    expect(await prisma.discoveredCandidate.count()).toBe(0)
  })
})

describe('hoursSince', () => {
  it('counts whole hours', () => {
    expect(hoursSince(new Date('2026-11-17T08:00:00Z'), Date.parse('2026-11-17T11:59:00Z'))).toBe(3)
  })
})
