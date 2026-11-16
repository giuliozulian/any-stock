import { describe, expect, it, vi, afterEach } from 'vitest'
import { getFullPriceHistory, mergeHistories, parseChartCloses } from '@/lib/history'

const DAY = 86_400
const START = Date.UTC(2020, 0, 6, 14, 30) / 1000

// Yahoo timestamps are in seconds.
const stamps = (n: number, stepDays = 1, start = START) => Array.from({ length: n }, (_, i) => start + i * stepDays * DAY)
const chart = (timestamp: unknown, close: unknown) => ({ chart: { result: [{ timestamp, indicators: { quote: [{ close }] } }] } })
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

const originalFetch = global.fetch
function mockFetch(...responses: Array<() => Response | Promise<Response>>) {
  const fn = vi.fn()
  responses.forEach((r) => fn.mockImplementationOnce(async () => r()))
  global.fetch = fn as unknown as typeof fetch
  return fn
}

afterEach(() => {
  global.fetch = originalFetch
  vi.useRealTimers()
})

describe('parseChartCloses', () => {
  it('converts seconds to milliseconds and keeps numeric closes', () => {
    expect(parseChartCloses(chart([START, START + DAY], [10, 11]))).toEqual([
      { t: START * 1000, close: 10 },
      { t: (START + DAY) * 1000, close: 11 },
    ])
  })

  it('drops null, non-finite, zero and negative closes', () => {
    const points = parseChartCloses(chart(stamps(5), [10, null, 0, -3, 12]))
    expect(points.map((p) => p.close)).toEqual([10, 12])
  })

  it('returns points in chronological order even when Yahoo does not', () => {
    const points = parseChartCloses(chart([START + 2 * DAY, START, START + DAY], [3, 1, 2]))
    expect(points.map((p) => p.close)).toEqual([1, 2, 3])
  })

  it('returns an empty list for malformed payloads', () => {
    expect(parseChartCloses({})).toEqual([])
    expect(parseChartCloses(null)).toEqual([])
    expect(parseChartCloses(chart('nope', [1]))).toEqual([])
    expect(parseChartCloses(chart([START], 'nope'))).toEqual([])
  })
})

describe('mergeHistories', () => {
  const sparse = [0, 30, 60, 90].map((d) => ({ t: d * DAY * 1000, close: d + 1 }))
  const dense = [59, 60, 61].map((d) => ({ t: d * DAY * 1000, close: 100 + d }))

  it('keeps sparse points only before the first dense point', () => {
    const merged = mergeHistories(sparse, dense)
    expect(merged.points.map((p) => p.close)).toEqual([1, 31, 159, 160, 161])
    expect(merged.sparseBefore).toBe(59 * DAY * 1000)
  })

  it('reports no sparse region when the dense series covers everything', () => {
    expect(mergeHistories(sparse.slice(2), dense).sparseBefore).toBeNull()
  })

  it('marks the whole series as sparse when there is no dense series', () => {
    expect(mergeHistories(sparse, [])).toEqual({ points: sparse, sparseBefore: 90 * DAY * 1000 })
  })
})

describe('getFullPriceHistory', () => {
  it('asks Yahoo for the full daily range with explicit dates', async () => {
    const fetchMock = mockFetch(() => ok(chart(stamps(10), stamps(10).map((_, i) => 100 + i))))
    const history = await getFullPriceHistory('fh-daily')
    expect(history.points).toHaveLength(10)
    expect(history.sparseBefore).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/v8/finance/chart/FH-DAILY?')
    expect(url).toContain('period1=0')
    expect(url).toMatch(/period2=\d+/)
    expect(url).toContain('interval=1d')
  })

  it('serves the cached series within six hours without refetching', async () => {
    const fetchMock = mockFetch(() => ok(chart(stamps(10), stamps(10).map(() => 5))))
    await getFullPriceHistory('FH-CACHED')
    await getFullPriceHistory('FH-CACHED')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('splices a daily 10-year request on top of a sparse answer', async () => {
    const monthly = stamps(24, 30)
    const daily = stamps(10, 1, monthly[20])
    const fetchMock = mockFetch(
      () => ok(chart(monthly, monthly.map(() => 1))),
      () => ok(chart(daily, daily.map(() => 2))),
    )
    const history = await getFullPriceHistory('FH-SPARSE')
    expect(String(fetchMock.mock.calls[1][0])).toContain('range=10y&interval=1d')
    expect(history.points.filter((p) => p.close === 1)).toHaveLength(20)
    expect(history.points.filter((p) => p.close === 2)).toHaveLength(10)
    expect(history.sparseBefore).toBe(daily[0] * 1000)
  })

  it('returns the sparse series, uncached, when the daily request fails', async () => {
    const monthly = stamps(24, 30)
    const body = chart(monthly, monthly.map(() => 1))
    const fetchMock = mockFetch(
      () => ok(body),
      () => new Response('', { status: 429 }),
      () => ok(body),
      () => new Response('', { status: 429 }),
    )
    const first = await getFullPriceHistory('FH-HALF')
    expect(first.points).toHaveLength(24)
    expect(first.sparseBefore).toBe(monthly[23] * 1000)
    await getFullPriceHistory('FH-HALF')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('returns an empty history on HTTP error with nothing cached', async () => {
    mockFetch(() => new Response('', { status: 500 }))
    expect(await getFullPriceHistory('FH-DOWN')).toEqual({ points: [], sparseBefore: null })
  })

  it('returns an empty history when fetch rejects or the body is malformed', async () => {
    mockFetch(() => {
      throw new Error('network')
    })
    expect(await getFullPriceHistory('FH-THROW')).toEqual({ points: [], sparseBefore: null })
    mockFetch(() => ok({ chart: { result: null } }))
    expect(await getFullPriceHistory('FH-BAD')).toEqual({ points: [], sparseBefore: null })
  })

  it('falls back to the stale cached series when a later refresh fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
    mockFetch(() => ok(chart(stamps(10), stamps(10).map(() => 7))))
    const fresh = await getFullPriceHistory('FH-STALE')
    vi.setSystemTime(new Date('2026-11-16T17:00:00Z'))
    mockFetch(() => new Response('', { status: 500 }))
    expect(await getFullPriceHistory('FH-STALE')).toEqual(fresh)
  })
})
