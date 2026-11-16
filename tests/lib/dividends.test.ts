import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDividendHistory, parseDividends } from '@/lib/dividends'

const DAY = 86_400
const START = Date.UTC(2024, 0, 10, 14, 30) / 1000

// Yahoo keys the dividends by timestamp; the amount and the date in seconds sit in the value.
const row = (date: unknown, amount: unknown) => ({ amount, date })
const chart = (dividends?: Record<string, unknown>, currency: unknown = 'USD') => ({
  chart: { result: [{ meta: { currency }, events: dividends === undefined ? undefined : { dividends } }] },
})
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

describe('parseDividends', () => {
  it('converts seconds to milliseconds and reads the currency', () => {
    const parsed = parseDividends(chart({ a: row(START, 0.5), b: row(START + 90 * DAY, 0.51) }))
    expect(parsed).toEqual({
      payments: [
        { t: START * 1000, amount: 0.5 },
        { t: (START + 90 * DAY) * 1000, amount: 0.51 },
      ],
      currency: 'USD',
    })
  })

  it('drops payments without a positive numeric amount or a numeric date', () => {
    const parsed = parseDividends(
      chart({
        a: row(START, 0),
        b: row(START + DAY, -1),
        c: row(START + 2 * DAY, 'x'),
        d: row(START + 3 * DAY, null),
        e: row('x', 1),
        f: row(START + 5 * DAY, 0.25),
      }),
    )
    expect(parsed?.payments).toEqual([{ t: (START + 5 * DAY) * 1000, amount: 0.25 }])
  })

  it('returns payments in chronological order even when Yahoo does not', () => {
    const parsed = parseDividends(chart({ a: row(START + 2 * DAY, 3), b: row(START, 1), c: row(START + DAY, 2) }))
    expect(parsed?.payments.map((p) => p.amount)).toEqual([1, 2, 3])
  })

  it('keeps the last of two payments on the same date', () => {
    const parsed = parseDividends(chart({ a: row(START, 1), b: row(START, 2) }))
    expect(parsed?.payments).toEqual([{ t: START * 1000, amount: 2 }])
  })

  it('returns no payments, not null, when Yahoo lists no dividend events', () => {
    expect(parseDividends(chart())).toEqual({ payments: [], currency: 'USD' })
    expect(parseDividends(chart({}))).toEqual({ payments: [], currency: 'USD' })
  })

  it('reads a missing or malformed currency as null', () => {
    const events = { a: row(START, 1) }
    expect(parseDividends(chart(events, null))?.currency).toBeNull()
    expect(parseDividends(chart(events, ''))?.currency).toBeNull()
    expect(parseDividends(chart(events, 42))?.currency).toBeNull()
  })

  it('returns null for payloads that are not a chart', () => {
    expect(parseDividends({})).toBeNull()
    expect(parseDividends(null)).toBeNull()
    expect(parseDividends({ chart: { result: null } })).toBeNull()
    expect(parseDividends({ chart: { result: [] } })).toBeNull()
  })
})

describe('getDividendHistory', () => {
  it('asks Yahoo for the whole history with monthly steps and dividend events', async () => {
    const fetchMock = mockFetch(() => ok(chart({ a: row(START, 0.5) })))
    const history = await getDividendHistory('dv-url')
    expect(history?.payments).toHaveLength(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/v8/finance/chart/DV-URL?')
    expect(url).toContain('range=max')
    expect(url).toContain('interval=1mo')
    expect(url).toContain('events=div')
  })

  it('serves the cached copy within six hours without refetching', async () => {
    const fetchMock = mockFetch(() => ok(chart({ a: row(START, 0.5) })))
    await getDividendHistory('DV-CACHED')
    await getDividendHistory('DV-CACHED')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caches a stock that pays nothing, so it is not refetched on every visit', async () => {
    const fetchMock = mockFetch(() => ok(chart()))
    expect(await getDividendHistory('DV-NONE')).toEqual({ payments: [], currency: 'USD' })
    await getDividendHistory('DV-NONE')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns null on an HTTP error with nothing cached', async () => {
    mockFetch(() => new Response('', { status: 500 }))
    expect(await getDividendHistory('DV-DOWN')).toBeNull()
  })

  it('returns null when fetch rejects or the body is not a chart', async () => {
    mockFetch(() => {
      throw new Error('network')
    })
    expect(await getDividendHistory('DV-THROW')).toBeNull()
    mockFetch(() => ok({ chart: { result: null } }))
    expect(await getDividendHistory('DV-BAD')).toBeNull()
  })

  it('falls back to the stale copy when a later refresh fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
    mockFetch(() => ok(chart({ a: row(START, 0.5) })))
    const fresh = await getDividendHistory('DV-STALE')
    vi.setSystemTime(new Date('2026-11-16T17:00:00Z'))
    mockFetch(() => new Response('', { status: 500 }))
    expect(await getDividendHistory('DV-STALE')).toEqual(fresh)
  })
})
