import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as congress from '@/lib/congress'
import * as politicianProfiles from '@/lib/politician-profiles'
import * as congressSignals from '@/lib/congress-signals'
import * as market from '@/lib/market'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import * as insiderData from '@/lib/insider-data'
import * as edgarForm4Feed from '@/lib/edgar-form4-feed'
import { resetDb } from '../helpers/db'
import { scoreCandidate, sourceCandidates, selectForEnrichment, runDiscoveryScan, type ScoreInput, type CandidateSeed } from '@/lib/discover'

function baseInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    price: 100,
    week52High: null,
    week52Low: null,
    changePct: 0,
    pegRatio: null,
    roe: null,
    debtToEquity: null,
    congressSignalScore: null,
    insiderBuyerCount: 0,
    market: 'US',
    ...overrides,
  }
}

describe('scoreCandidate — momentum', () => {
  it('scores purely on move size when 52-week range is missing', () => {
    const result = scoreCandidate(baseInput({ changePct: 30 }))
    expect(result.momentumScore).toBe(100)
  })

  it('averages range position and move size when both are available', () => {
    // price at the exact 52-week high -> rangePoints = 100; changePct 15 -> movePoints = 50
    const result = scoreCandidate(baseInput({ price: 180, week52High: 180, week52Low: 120, changePct: 15 }))
    expect(result.momentumScore).toBe(75)
  })

  it('caps move points at 100 for rises at or above 30%', () => {
    const result = scoreCandidate(baseInput({ changePct: 45 }))
    expect(result.momentumScore).toBe(100)
  })

  it('gives no move points to a fall: a crash is not momentum', () => {
    expect(scoreCandidate(baseInput({ changePct: -45 })).momentumScore).toBe(0)
    expect(scoreCandidate(baseInput({ changePct: -30 })).momentumScore).toBe(0)
  })

  it('scores a fall below the same rise, with the same 52-week range', () => {
    const range = { price: 150, week52High: 180, week52Low: 120 }
    const rise = scoreCandidate(baseInput({ ...range, changePct: 30 })).momentumScore
    const fall = scoreCandidate(baseInput({ ...range, changePct: -30 })).momentumScore
    expect(fall).toBeLessThan(rise)
    expect(fall).toBe(25) // only the range position counts: (50 + 0) / 2
  })
})

describe('scoreCandidate — fundamentals', () => {
  it('gives full points for PEG<=1, ROE>15, debt<1', () => {
    const result = scoreCandidate(baseInput({ pegRatio: 0.8, roe: 20, debtToEquity: 0.5 }))
    expect(result.fundamentalsScore).toBe(100)
  })

  it('gives partial points for mid-band values', () => {
    const result = scoreCandidate(baseInput({ pegRatio: 1.5, roe: 10, debtToEquity: 1.5 }))
    expect(result.fundamentalsScore).toBe(20 + 20 + 10)
  })

  it('gives no debt points to negative equity, and says so in the reason', () => {
    const result = scoreCandidate(baseInput({ debtToEquity: -3 }))
    expect(result.fundamentalsScore).toBe(0)
    expect(result.reason).toContain('Patrimonio netto negativo')
    expect(result.reason).toContain('0/20 punti')
  })

  it('scores the debt rule identically in the score and in the reason text', () => {
    for (const debt of [-1, 0, 0.5, 0.99, 1, 1.5, 2, 5]) {
      const result = scoreCandidate(baseInput({ debtToEquity: debt, pegRatio: null, roe: null }))
      const shown = Number(result.reason.match(/(\d+)\/20 punti/)![1])
      expect(shown).toBe(result.fundamentalsScore)
    }
  })

  it('gives zero points for a loss-making, overleveraged, overpriced stock', () => {
    const result = scoreCandidate(baseInput({ pegRatio: 3, roe: -5, debtToEquity: 2.5 }))
    expect(result.fundamentalsScore).toBe(0)
  })

  it('treats null fundamentals as zero points, never a crash', () => {
    const result = scoreCandidate(baseInput())
    expect(result.fundamentalsScore).toBe(0)
  })
})

describe('scoreCandidate — insider/congress', () => {
  it('is always zero for the Italian market, regardless of other inputs', () => {
    const result = scoreCandidate(baseInput({ market: 'IT', congressSignalScore: 15, insiderBuyerCount: 5 }))
    expect(result.insiderScore).toBe(0)
  })

  it('normalizes a congress signal score onto the 0-100 scale', () => {
    const result = scoreCandidate(baseInput({ congressSignalScore: 6 }))
    expect(result.insiderScore).toBe(50)
  })

  it('takes the stronger of congress and insider signals, not their sum', () => {
    const result = scoreCandidate(baseInput({ congressSignalScore: 6, insiderBuyerCount: 4 }))
    expect(result.insiderScore).toBe(100)
  })

  it('is zero when there is no signal at all', () => {
    const result = scoreCandidate(baseInput())
    expect(result.insiderScore).toBe(0)
  })
})

describe('scoreCandidate — combined score and reason', () => {
  it('averages three pillars for US stocks', () => {
    const result = scoreCandidate(baseInput({ changePct: 30, pegRatio: 0.8, roe: 20, debtToEquity: 0.5, congressSignalScore: 12 }))
    expect(result.score).toBe(100)
  })

  it('averages only two pillars for IT stocks', () => {
    const result = scoreCandidate(baseInput({ market: 'IT', changePct: 30, pegRatio: 0.8, roe: 20, debtToEquity: 0.5 }))
    expect(result.score).toBe(100)
  })

  it('mentions the Italian market disclaimer in the reason', () => {
    const result = scoreCandidate(baseInput({ market: 'IT' }))
    expect(result.reason).toContain('titoli italiani')
  })

  it('falls back to a generic reason when every pillar is weak', () => {
    const result = scoreCandidate(baseInput())
    expect(result.reason).toContain('Segnali deboli')
  })
})

describe('sourceCandidates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Default: no EDGAR cluster signal, so the 4 pre-existing tests below (written before this source existed) don't hit real network. Tests that care override it.
    vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockResolvedValue([])
  })

  it('combines congress buys and US/IT movers into one deduped list', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([
      { member: 'Jane Doe', chamber: 'house', state: 'CA', side: 'buy', amountLow: 50_000, amountHigh: 100_000, date: '2026-11-01', disclosedAt: '2026-11-05', ticker: 'NVDA', asset: 'Nvidia Corp', perfPct: null },
    ])
    vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
    vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([
      { ticker: 'NVDA', asset: 'Nvidia Corp', members: ['Jane Doe'], trades: 1, totalLow: 50_000, totalHigh: 100_000, firstDate: '2026-11-01', lastDisclosedAt: '2026-11-05', avgPerfPct: null, timing: 'unknown', avgExcessPct: null, sellers: 0, maxLagDays: 0, score: 8, reasons: [] },
    ])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us'
        ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, relVolume: null, exchange: null }]
        : [{ symbol: 'ENI.MI', name: 'Eni', changePct: -16, price: 14, marketCap: null, volume: null, relVolume: null, exchange: null }]
    )

    const seeds = await sourceCandidates(new Set())

    expect(seeds.map((s) => s.symbol).sort()).toEqual(['ENI.MI', 'MSFT', 'NVDA'])
    const nvda = seeds.find((s) => s.symbol === 'NVDA')!
    expect(nvda.market).toBe('US')
    expect(nvda.source).toEqual(['congress'])
    expect(nvda.congressScore).toBe(8)
    const eni = seeds.find((s) => s.symbol === 'ENI.MI')!
    expect(eni.market).toBe('IT')
    expect(eni.congressScore).toBeNull()
  })

  it('merges sources for a symbol that appears in more than one feed', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([
      { member: 'Jane Doe', chamber: 'house', state: 'CA', side: 'buy', amountLow: 50_000, amountHigh: 100_000, date: '2026-11-01', disclosedAt: '2026-11-05', ticker: 'NVDA', asset: 'Nvidia Corp', perfPct: null },
    ])
    vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
    vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([
      { ticker: 'NVDA', asset: 'Nvidia Corp', members: ['Jane Doe'], trades: 1, totalLow: 50_000, totalHigh: 100_000, firstDate: '2026-11-01', lastDisclosedAt: '2026-11-05', avgPerfPct: null, timing: 'unknown', avgExcessPct: null, sellers: 0, maxLagDays: 0, score: 8, reasons: [] },
    ])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'NVDA', name: 'Nvidia', changePct: 22, price: 500, marketCap: null, volume: null, relVolume: null, exchange: null }] : []
    )

    const seeds = await sourceCandidates(new Set())

    expect(seeds).toHaveLength(1)
    expect(seeds[0].source.sort()).toEqual(['congress', 'yahoo-movers-us'])
    expect(seeds[0].seedChangePct).toBe(22)
  })

  it('excludes symbols already in the watchlist', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
    vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
    vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, relVolume: null, exchange: null }] : []
    )

    const seeds = await sourceCandidates(new Set(['MSFT']))

    expect(seeds).toHaveLength(0)
  })

  it('does not let one failing source block the others', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockRejectedValue(new Error('down'))
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, relVolume: null, exchange: null }] : []
    )

    const seeds = await sourceCandidates(new Set())

    expect(seeds.map((s) => s.symbol)).toEqual(['MSFT'])
  })

  it('adds a cluster-only seed from EDGAR Form4 with no price/change data', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
    vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
    vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([])
    vi.spyOn(market, 'getMarketBigMovers').mockResolvedValue([])
    vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockResolvedValue([{ symbol: 'ACME', name: 'Acme Corp', buyerCount: 3 }])

    const seeds = await sourceCandidates(new Set())

    expect(seeds).toHaveLength(1)
    expect(seeds[0]).toMatchObject({ symbol: 'ACME', name: 'Acme Corp', market: 'US', source: ['edgar-form4-cluster'], seedPrice: null, seedChangePct: null, congressScore: null, clusterBuyerCount: 3 })
  })

  it('merges an EDGAR cluster signal onto a symbol already found by movers, without duplicating it', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
    vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
    vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, relVolume: null, exchange: null }] : []
    )
    vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockResolvedValue([{ symbol: 'MSFT', name: 'Microsoft Corp', buyerCount: 2 }])

    const seeds = await sourceCandidates(new Set())

    expect(seeds).toHaveLength(1)
    expect(seeds[0].source.sort()).toEqual(['edgar-form4-cluster', 'yahoo-movers-us'])
    expect(seeds[0].clusterBuyerCount).toBe(2)
  })

  it('does not let a failing EDGAR cluster source block the other sources', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
    vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
    vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, relVolume: null, exchange: null }] : []
    )
    vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockRejectedValue(new Error('SEC down'))

    const seeds = await sourceCandidates(new Set())

    expect(seeds.map((s) => s.symbol)).toEqual(['MSFT'])
  })
})

describe('selectForEnrichment', () => {
  function seed(symbol: string, market: 'US' | 'IT', overrides: Partial<CandidateSeed> = {}): CandidateSeed {
    return { symbol, name: symbol, market, source: ['yahoo-movers-us'], seedPrice: 10, seedChangePct: 20, congressScore: null, clusterBuyerCount: null, ...overrides }
  }
  function clusterOnlySeed(symbol: string, buyerCount: number): CandidateSeed {
    return { symbol, name: symbol, market: 'US', source: ['edgar-form4-cluster'], seedPrice: null, seedChangePct: null, congressScore: null, clusterBuyerCount: buyerCount }
  }

  it('caps the general US pool at 10 (14 minus the 4 reserved cluster slots) when there are no cluster-only candidates', () => {
    const seeds = [...Array(20)].map((_, i) => seed(`US${i}`, 'US')).concat([...Array(10)].map((_, i) => seed(`IT${i}`, 'IT')))
    const result = selectForEnrichment(seeds)
    expect(result.filter((s) => s.market === 'US')).toHaveLength(10)
    expect(result.filter((s) => s.market === 'IT')).toHaveLength(6)
  })

  it('does not give IT leftover US slots when IT has fewer candidates than its quota', () => {
    const seeds = [...Array(20)].map((_, i) => seed(`US${i}`, 'US')).concat([seed('ENI.MI', 'IT')])
    const result = selectForEnrichment(seeds)
    expect(result.filter((s) => s.market === 'US')).toHaveLength(10)
    expect(result.filter((s) => s.market === 'IT')).toHaveLength(1)
  })

  it('reserves up to 4 slots for cluster-only candidates, shrinking the general pool to 10', () => {
    const movers = [...Array(20)].map((_, i) => seed(`US${i}`, 'US'))
    const clusters = [clusterOnlySeed('C1', 5), clusterOnlySeed('C2', 4), clusterOnlySeed('C3', 3), clusterOnlySeed('C4', 2)]
    const result = selectForEnrichment([...movers, ...clusters])
    const us = result.filter((s) => s.market === 'US')
    expect(us).toHaveLength(14)
    expect(us.filter((s) => s.source.includes('edgar-form4-cluster')).map((s) => s.symbol).sort()).toEqual(['C1', 'C2', 'C3', 'C4'])
  })

  it('keeps only the top 4 cluster-only candidates by buyerCount when more than 4 are available', () => {
    const movers = [...Array(20)].map((_, i) => seed(`US${i}`, 'US'))
    const clusters = [clusterOnlySeed('LOW1', 2), clusterOnlySeed('HIGH1', 9), clusterOnlySeed('LOW2', 2), clusterOnlySeed('HIGH2', 8), clusterOnlySeed('HIGH3', 7), clusterOnlySeed('HIGH4', 6)]
    const result = selectForEnrichment([...movers, ...clusters])
    const chosenClusters = result.filter((s) => s.source.includes('edgar-form4-cluster')).map((s) => s.symbol)
    expect(chosenClusters.sort()).toEqual(['HIGH1', 'HIGH2', 'HIGH3', 'HIGH4'])
  })

  it('does not hand unused reserved slots to movers when fewer than 4 cluster-only candidates exist', () => {
    const movers = [...Array(20)].map((_, i) => seed(`US${i}`, 'US'))
    const clusters = [clusterOnlySeed('C1', 5)]
    const result = selectForEnrichment([...movers, ...clusters])
    const us = result.filter((s) => s.market === 'US')
    expect(us).toHaveLength(11) // 10 general + 1 cluster, the other 3 reserved slots stay empty
    expect(us.some((s) => s.symbol === 'C1')).toBe(true)
  })
})

describe('runDiscoveryScan', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
    // Default: no EDGAR cluster signal, so these pre-existing tests (written before this source existed) don't hit real network.
    vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockResolvedValue([])
  })

  it('upserts a scored candidate sourced from a US mover', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, relVolume: null, exchange: null }] : []
    )
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({
      peRatio: 28, week52High: 420, week52Low: 300, pegRatio: 1.2, roe: 30, netMargin: 25, debtToEquity: 0.5, dividendYield: 0.8, payoutRatio: 20, relativePerf13W: 5, epsTTM: 10, epsGrowth5Y: 15, bookValuePerShare: 20, cashFlowPerShare: 12,
    })
    vi.spyOn(insiderData, 'getInsiderData').mockResolvedValue({ trades: [], sentiment: [] })

    const result = await runDiscoveryScan()

    expect(result.candidates).toBe(1)
    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    expect(stored?.market).toBe('US')
    expect(stored?.partial).toBe(false)
    expect(stored?.scannedAt).toEqual(result.scannedAt)
  })

  it('flags a candidate as partial when getMetrics fails, but keeps it', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, relVolume: null, exchange: null }] : []
    )
    vi.spyOn(finnhub, 'getMetrics').mockRejectedValue(new Error('rate limited'))
    vi.spyOn(insiderData, 'getInsiderData').mockResolvedValue({ trades: [], sentiment: [] })

    const result = await runDiscoveryScan()

    expect(result.candidates).toBe(1)
    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    expect(stored?.partial).toBe(true)
  })

  it('drops a congress-only candidate when both getQuote and getMetrics fail (no usable price)', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([
      { member: 'Jane Doe', chamber: 'house', state: 'CA', side: 'buy', amountLow: 50_000, amountHigh: 100_000, date: '2026-11-01', disclosedAt: '2026-11-05', ticker: 'NVDA', asset: 'Nvidia Corp', perfPct: null },
    ])
    vi.spyOn(market, 'getMarketBigMovers').mockResolvedValue([])
    vi.spyOn(finnhub, 'getQuote').mockRejectedValue(new Error('down'))
    vi.spyOn(finnhub, 'getMetrics').mockRejectedValue(new Error('down'))

    const result = await runDiscoveryScan()

    expect(result.candidates).toBe(0)
    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'NVDA' } })
    expect(stored).toBeNull()
  })

  it('drops a congress-only candidate whose quote comes back as 0 (unknown symbol), instead of scoring it at price 0', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([
      { member: 'Jane Doe', chamber: 'house', state: 'CA', side: 'buy', amountLow: 50_000, amountHigh: 100_000, date: '2026-11-01', disclosedAt: '2026-11-05', ticker: 'ZZZZ', asset: 'Unknown Corp', perfPct: null },
    ] as never)
    vi.spyOn(market, 'getMarketBigMovers').mockResolvedValue([])
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({ currentPrice: 0, changePercent: 0, high: 0, low: 0, open: 0, previousClose: 0 })
    vi.spyOn(finnhub, 'getMetrics').mockRejectedValue(new Error('down'))

    const result = await runDiscoveryScan()

    expect(result.candidates).toBe(0)
    expect(await prisma.discoveredCandidate.findUnique({ where: { symbol: 'ZZZZ' } })).toBeNull()
  })

  it('does not touch existing rows when every source fails', async () => {
    await prisma.discoveredCandidate.create({
      data: { symbol: 'OLD', name: 'Old Co.', market: 'US', score: 70, momentumScore: 70, fundamentalsScore: 70, insiderScore: 70, reason: 'previous scan', source: 'yahoo-movers-us' },
    })
    vi.spyOn(congress, 'getRecentCongressBuys').mockRejectedValue(new Error('down'))
    vi.spyOn(market, 'getMarketBigMovers').mockRejectedValue(new Error('down'))

    const result = await runDiscoveryScan()

    expect(result.candidates).toBe(0)
    const stillThere = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'OLD' } })
    expect(stillThere).not.toBeNull()
  })

  it('un-dismisses a candidate that reappears in a new scan', async () => {
    await prisma.discoveredCandidate.create({
      data: { symbol: 'MSFT', name: 'Microsoft', market: 'US', score: 10, momentumScore: 10, fundamentalsScore: 10, insiderScore: 10, reason: 'old', source: 'yahoo-movers-us', dismissedAt: new Date() },
    })
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, relVolume: null, exchange: null }] : []
    )
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({
      peRatio: null, week52High: null, week52Low: null, pegRatio: null, roe: null, netMargin: null, debtToEquity: null, dividendYield: null, payoutRatio: null, relativePerf13W: null, epsTTM: null, epsGrowth5Y: null,
    })
    vi.spyOn(insiderData, 'getInsiderData').mockResolvedValue(null)

    await runDiscoveryScan()

    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    expect(stored?.dismissedAt).toBeNull()
  })
})
