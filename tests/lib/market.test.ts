import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bigMovers, buildSnapshot, isCommonStock, isMarketLive, relativeVolume } from '@/lib/market'

describe('bigMovers', () => {
  it('keeps only moves of at least the threshold either way, largest first', () => {
    const items = [
      { symbol: 'A', name: 'A', changePct: 3 },
      { symbol: 'B', name: 'B', changePct: -16 },
      { symbol: 'C', name: 'C', changePct: 5 },
      { symbol: 'D', name: 'D', changePct: 22 },
      { symbol: 'E', name: 'E', changePct: -4.9 },
    ]
    expect(bigMovers(items).map((i) => i.symbol)).toEqual(['D', 'B', 'C'])
    expect(bigMovers(items, 15).map((i) => i.symbol)).toEqual(['D', 'B'])
  })
})

describe('relativeVolume', () => {
  it('divides today by the average and is null without data', () => {
    expect(relativeVolume(300, 100)).toBe(3)
    expect(relativeVolume(undefined, 100)).toBeNull()
    expect(relativeVolume(300, 0)).toBeNull()
  })
})

describe('isCommonStock', () => {
  it.each(['Acme Acquisition Corp. Warrant', 'Foo Rights', 'Bar Units', 'Baz Preferred Stock'])('rejects %s', (name) => {
    expect(isCommonStock({ symbol: 'X', shortName: name })).toBe(false)
  })
  it('accepts a company', () => {
    expect(isCommonStock({ symbol: 'AAPL', shortName: 'Apple Inc.' })).toBe(true)
  })
})

describe('buildSnapshot', () => {
  const q = (symbol: string, pct: number, price: number, extra: object = {}) => ({ symbol, shortName: symbol, regularMarketChangePercent: pct, regularMarketPrice: price, ...extra })
  it('drops duplicates, sub-$1 stocks and warrants, adds relative volume and the market clock', () => {
    const snapshot = buildSnapshot(
      [
        q('UP', 30, 10, { regularMarketVolume: 900, averageDailyVolume3Month: 300, marketState: 'REGULAR', regularMarketTime: 1_700_000_000 }),
        q('PENNY', 80, 0.5),
        q('UPW', 40, 3, { shortName: 'Up Acquisition Warrant' }),
        q('DOWN', -20, 5),
        q('UP', 30, 10),
      ],
      123
    )
    expect(snapshot.movers.map((m) => m.symbol)).toEqual(['UP', 'DOWN'])
    expect(snapshot.movers[0].relVolume).toBe(3)
    expect(snapshot.asOf).toBe(1_700_000_000_000)
    expect(snapshot.marketState).toBe('REGULAR')
  })
})

describe('isMarketLive', () => {
  it('is true only during the regular session', () => {
    expect(isMarketLive('REGULAR')).toBe(true)
    expect(isMarketLive('PRE')).toBe(false)
    expect(isMarketLive(null)).toBe(false)
  })
})

describe('getMarketSnapshot', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('SHARED_CACHE_DB', '0')
  })

  it('reuses the crumb and the cached result across calls', async () => {
    const { getMarketSnapshot } = await import('@/lib/market')
    const quote = { symbol: 'UP', shortName: 'UP', regularMarketChangePercent: 9, regularMarketPrice: 10 }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('fc.yahoo.com')) return Promise.resolve({ headers: { getSetCookie: () => ['A=1; Path=/'] } })
      if (url.includes('getcrumb')) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('crumb') })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ finance: { result: [{ quotes: [quote] }] } }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const first = await getMarketSnapshot('us')
    const callsAfterFirst = fetchMock.mock.calls.length
    await getMarketSnapshot('us')
    vi.unstubAllGlobals()
    expect(first.movers.map((m) => m.symbol)).toEqual(['UP'])
    expect(callsAfterFirst).toBe(4)
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
  })
})
