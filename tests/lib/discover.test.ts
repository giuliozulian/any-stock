import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as congress from '@/lib/congress'
import * as politicianProfiles from '@/lib/politician-profiles'
import * as congressSignals from '@/lib/congress-signals'
import * as market from '@/lib/market'
import { scoreCandidate, sourceCandidates, selectForEnrichment, type ScoreInput, type CandidateSeed } from '@/lib/discover'

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

  it('caps move points at 100 for moves at or above 30%', () => {
    const result = scoreCandidate(baseInput({ changePct: -45 }))
    expect(result.momentumScore).toBe(100)
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
    expect(result.reason).toContain('Mercato italiano')
  })

  it('falls back to a generic reason when every pillar is weak', () => {
    const result = scoreCandidate(baseInput())
    expect(result.reason).toContain('Segnale debole')
  })
})

describe('sourceCandidates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('combines congress buys and US/IT movers into one deduped list', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([
      { member: 'Jane Doe', chamber: 'house', state: 'CA', side: 'buy', amountLow: 50_000, amountHigh: 100_000, date: '2026-11-01', disclosedAt: '2026-11-05', ticker: 'NVDA', asset: 'Nvidia Corp', perfPct: null },
    ])
    vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
    vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([
      { ticker: 'NVDA', asset: 'Nvidia Corp', members: ['Jane Doe'], trades: 1, totalLow: 50_000, totalHigh: 100_000, firstDate: '2026-11-01', lastDisclosedAt: '2026-11-05', avgPerfPct: null, timing: 'unknown', score: 8, reasons: [] },
    ])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us'
        ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, exchange: null }]
        : [{ symbol: 'ENI.MI', name: 'Eni', changePct: -16, price: 14, marketCap: null, volume: null, exchange: null }]
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
      { ticker: 'NVDA', asset: 'Nvidia Corp', members: ['Jane Doe'], trades: 1, totalLow: 50_000, totalHigh: 100_000, firstDate: '2026-11-01', lastDisclosedAt: '2026-11-05', avgPerfPct: null, timing: 'unknown', score: 8, reasons: [] },
    ])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'NVDA', name: 'Nvidia', changePct: 22, price: 500, marketCap: null, volume: null, exchange: null }] : []
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
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, exchange: null }] : []
    )

    const seeds = await sourceCandidates(new Set(['MSFT']))

    expect(seeds).toHaveLength(0)
  })

  it('does not let one failing source block the others', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockRejectedValue(new Error('down'))
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, exchange: null }] : []
    )

    const seeds = await sourceCandidates(new Set())

    expect(seeds.map((s) => s.symbol)).toEqual(['MSFT'])
  })
})

describe('selectForEnrichment', () => {
  function seed(symbol: string, market: 'US' | 'IT'): CandidateSeed {
    return { symbol, name: symbol, market, source: ['yahoo-movers-us'], seedPrice: 10, seedChangePct: 20, congressScore: null }
  }

  it('takes at most 14 US and 6 IT candidates by default', () => {
    const seeds = [...Array(20)].map((_, i) => seed(`US${i}`, 'US')).concat([...Array(10)].map((_, i) => seed(`IT${i}`, 'IT')))
    const result = selectForEnrichment(seeds)
    expect(result.filter((s) => s.market === 'US')).toHaveLength(14)
    expect(result.filter((s) => s.market === 'IT')).toHaveLength(6)
  })

  it('does not give IT leftover US slots when IT has fewer candidates than its quota', () => {
    const seeds = [...Array(20)].map((_, i) => seed(`US${i}`, 'US')).concat([seed('ENI.MI', 'IT')])
    const result = selectForEnrichment(seeds)
    expect(result.filter((s) => s.market === 'US')).toHaveLength(14)
    expect(result.filter((s) => s.market === 'IT')).toHaveLength(1)
  })
})
