# Long Price History, Performance and Drawdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Andamento" tab to the stock page showing multi-period performance, year-by-year returns and drawdown from all-time highs, and add 5A / 10A / Max ranges to the existing price chart.

**Architecture:** A new `getFullPriceHistory` in `lib/history.ts` downloads the full daily close series from Yahoo on demand (6-hour in-memory cache, no DB). A new network-free module `lib/performance.ts` turns that series into period returns, calendar-year returns, a drawdown series and summary, and a downsampled series for the browser. Three small server-rendered SVG/HTML components show the results inside a `PerformancePanel`, mounted as a new tab in `app/stock/[symbol]/page.tsx`; `PriceHistoryChart` gets an optional long series for the new ranges.

**Tech Stack:** TypeScript, Next.js 16.4.6 App Router (`cacheComponents: true`), React 19, Vitest 5 + Testing Library (jsdom), CSS modules, hand-written SVG. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-price-performance-design.md`

## Global Constraints

- **Next.js here is not the Next.js you know** (`AGENTS.md`): before editing anything under `app/`, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices. `next.config` has `cacheComponents: true`, so `new Date()` / `Date.now()` in a server component is only allowed after `await connection()` has run in that render path.
- Price basis: **split-adjusted close, no dividends**. Use the `close` array of Yahoo's chart response. Never use `adjclose`.
- No new npm dependency, no chart library, no Prisma migration, no new DB table.
- `getPriceHistory` (1 year) and `getIntradayHistory` in `lib/history.ts` must stay byte-for-byte unchanged.
- `lib/performance.ts` is pure: no `fetch`, no `Date.now()`, no `new Date()` without an argument. The reference date always arrives as a `now: Date` parameter. All calendar math is in **UTC**.
- Percentages are plain numbers in percent units (`25` means 25%), named `...Pct`.
- UI copy is Italian. Exact strings: tab label `Andamento`; empty state `Storico non disponibile al momento.`; at-highs sentence starts with `Sui massimi storici.`; partial-year marker `(parziale)`.
- Numbers are formatted with `formatPct` (Task 2): `it-IT` decimal comma, one decimal below 1000%, none above, `+` for gains and the real minus sign `−` (U+2212) for losses, matching the minus already used in `app/stock/[symbol]/page.tsx`.
- Charts are hand-written SVG with a `viewBox` and `width: 100%`, so the page never scrolls horizontally at phone width. Every chart `<svg>` has `role="img"` and an `aria-label` summarising its content.
- Colors come from existing tokens in `app/globals.css` only: `--gain-bright`, `--loss-bright`, `--surface`, `--surface-raised`, `--rule`, `--bone`, `--muted`, `--radius-card`, `--radius-inner`, `--card-shadow`.
- Yahoo requests use `headers: { 'User-Agent': 'Mozilla/5.0' }`, same as the existing calls in `lib/history.ts`.
- Commit messages and code comments must not mention any AI tool or assistant, and must not carry `Co-Authored-By` or "Generated with" trailers.
- Work directly on `main`. Do not push.
- Run a single test file with `npx vitest run <path>`; typecheck with `npx tsc --noEmit`; lint with `npm run lint`. The full suite (`npm test`) needs the test Postgres from `.env.test`.

## Review Focus

- **Suspended or delisted ticker whose last close is months old:** short periods (1 month, 6 months) must be omitted, not shown as a misleading `0,0%` computed against the last point itself. Pinned in Task 2.
- **Flat or degenerate series (every close identical, or every yearly return 0):** charts must render without `NaN` in any SVG attribute and without dividing by zero. Pinned in Tasks 4 and 5.
- **Yahoo rows with a zero or negative close, or timestamps out of order:** must be dropped/sorted at parse time so no return is ever computed against 0. Pinned in Task 1.
- **Stocks with very long histories (60+ years of bars):** the yearly chart must stay readable at phone width by thinning year labels, never overlapping them. Pinned in Task 4.
- **Extreme lifetime returns (NVDA-style `+400.000%`):** tiles must format without decimals and with thousands separators rather than overflowing the tile. Pinned in Task 2.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/history.ts` (modify) | Add `FullHistory`, `parseChartCloses`, `mergeHistories`, `getFullPriceHistory`. Existing functions untouched. |
| `lib/performance.ts` (create) | Pure calculations: `periodReturns`, `yearlyReturns`, `drawdownSeries`, `drawdownSummary`, `downsample`, `formatPct`. |
| `components/PerformanceTiles.tsx` + `.module.css` (create) | Grid of period-return tiles. |
| `components/YearlyReturnsChart.tsx` + `.module.css` (create) | SVG bar chart, one bar per calendar year. |
| `components/DrawdownChart.tsx` + `.module.css` (create) | Summary sentence + SVG underwater area chart. |
| `components/PerformancePanel.tsx` + `.module.css` (create) | Composes the three blocks from a `FullHistory`; owns the empty state and the data notes. |
| `components/PriceHistoryChart.tsx` (modify) | New optional `long` prop and ranges `5A`, `10A`, `Max`. |
| `app/stock/[symbol]/page.tsx` (modify) | Fetch full history, pass `long` to the chart (two call sites), add the `Andamento` tab. |
| `tests/lib/history.test.ts`, `tests/lib/performance.test.ts`, `tests/components/PerformanceTiles.test.tsx`, `tests/components/YearlyReturnsChart.test.tsx`, `tests/components/DrawdownChart.test.tsx`, `tests/components/PerformancePanel.test.tsx`, `tests/components/PriceHistoryChart.test.tsx` (create) | Tests. |

Two deliberate refinements of the spec, already written back into it:

1. `getFullPriceHistory` returns `FullHistory { points, sparseBefore }` instead of a bare `PricePoint[]`, so the UI can tell the user when old data is sparser than daily (the spec's "ripiego e lo segnalo").
2. `drawdownSummary` takes `now` so "giorni fa" is measured from today without reading the clock inside a pure function.

---

### Task 1: Full price history from Yahoo

**Files:**
- Modify: `lib/history.ts` (append after `getPriceHistory`, before `IntradayPoint`; do not edit existing code)
- Test: `tests/lib/history.test.ts` (create)

**Interfaces:**
- Consumes: existing `PricePoint { t: number; close: number }` from `lib/history.ts` (`t` in milliseconds).
- Produces:
  - `interface FullHistory { points: PricePoint[]; sparseBefore: number | null }` — `points` ascending by `t`; `sparseBefore` is a millisecond timestamp before which data is sparser than daily, or `null` when the whole series is daily.
  - `parseChartCloses(json: unknown): PricePoint[]`
  - `mergeHistories(sparse: PricePoint[], dense: PricePoint[]): FullHistory`
  - `getFullPriceHistory(symbol: string): Promise<FullHistory>` — never throws.

Background for the implementer: a manual probe showed `range=max&interval=1d` returns **monthly** points for NVDA (335 points over 27 years). The request with explicit `period1`/`period2` is unverified. So the function asks for the full range with explicit dates, measures the average gap between points, and only if the answer is sparse makes a second request for the last 10 years daily and splices it on top. Both outcomes are handled in code; Task 7 checks live which one Yahoo actually takes.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/history.test.ts`:

```ts
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
```

Each test uses its own symbol because the cache is module-level and survives between tests.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/history.test.ts`
Expected: FAIL — `parseChartCloses`, `mergeHistories` and `getFullPriceHistory` are not exported from `@/lib/history`.

- [ ] **Step 3: Implement**

In `lib/history.ts`, insert this block between the end of `getPriceHistory` and `export interface IntradayPoint`:

```ts
export interface FullHistory {
  points: PricePoint[]
  // Points before this timestamp are sparser than daily (Yahoo thins out old data); null when the whole series is daily.
  sparseBefore: number | null
}

const FULL_TTL_MS = 6 * 60 * 60 * 1000
const DAY_MS = 86_400_000
const fullCache = new Map<string, { at: number; data: FullHistory }>()
const EMPTY_FULL: FullHistory = { points: [], sparseBefore: null }

// Split-adjusted closes from a Yahoo chart payload, oldest first. Rows without a positive close are dropped.
export function parseChartCloses(json: unknown): PricePoint[] {
  const result = (json as { chart?: { result?: Array<{ timestamp?: unknown; indicators?: { quote?: Array<{ close?: unknown }> } }> | null } } | null)?.chart?.result?.[0]
  const stamps = result?.timestamp
  const closes = result?.indicators?.quote?.[0]?.close
  if (!Array.isArray(stamps) || !Array.isArray(closes)) return []
  const points: PricePoint[] = []
  stamps.forEach((t, i) => {
    const close = closes[i]
    if (typeof t === 'number' && typeof close === 'number' && Number.isFinite(close) && close > 0) points.push({ t: t * 1000, close })
  })
  return points.sort((a, b) => a.t - b.t)
}

// Daily data averages under 1.5 calendar days between points; weekly is 7, monthly about 30.
function isSparse(points: PricePoint[]): boolean {
  if (points.length < 2) return false
  return (points[points.length - 1].t - points[0].t) / (points.length - 1) > 3 * DAY_MS
}

export function mergeHistories(sparse: PricePoint[], dense: PricePoint[]): FullHistory {
  if (dense.length === 0) return { points: sparse, sparseBefore: sparse.length > 0 ? sparse[sparse.length - 1].t : null }
  const older = sparse.filter((p) => p.t < dense[0].t)
  return { points: [...older, ...dense], sparseBefore: older.length > 0 ? dense[0].t : null }
}

async function fetchChart(key: string, query: string): Promise<PricePoint[] | null> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?${query}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null
  return parseChartCloses(await res.json())
}

// Whole listing history, for long-range performance. Returns the stale series (or an empty one) when Yahoo fails.
export async function getFullPriceHistory(symbol: string): Promise<FullHistory> {
  const key = symbol.toUpperCase()
  const hit = fullCache.get(key)
  if (hit && Date.now() - hit.at < FULL_TTL_MS) return hit.data

  try {
    const all = await fetchChart(key, `period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d`)
    if (!all || all.length === 0) return hit?.data ?? EMPTY_FULL
    if (!isSparse(all)) {
      const data: FullHistory = { points: all, sparseBefore: null }
      fullCache.set(key, { at: Date.now(), data })
      return data
    }
    const recent = await fetchChart(key, 'range=10y&interval=1d').catch(() => null)
    if (!recent || recent.length === 0 || isSparse(recent)) return hit?.data ?? mergeHistories(all, [])
    const data = mergeHistories(all, recent)
    fullCache.set(key, { at: Date.now(), data })
    return data
  } catch {
    return hit?.data ?? EMPTY_FULL
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/history.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add lib/history.ts tests/lib/history.test.ts
git commit -m "feat: fetch full daily price history from Yahoo with sparse-data fallback"
```

---

### Task 2: Period and calendar-year returns

**Files:**
- Create: `lib/performance.ts`
- Test: `tests/lib/performance.test.ts` (create)

**Interfaces:**
- Consumes: `PricePoint` from `@/lib/history` (type only).
- Produces:
  - `type PeriodKey = '1M' | '6M' | 'YTD' | '1A' | '3A' | '5A' | '10A' | '20A' | 'MAX'`
  - `interface PeriodReturn { key: PeriodKey; returnPct: number }`
  - `periodReturns(points: PricePoint[], now: Date): PeriodReturn[]` — in the fixed order `1M, 6M, YTD, 1A, 3A, 5A, 10A, 20A, MAX`, omitting periods the series cannot cover.
  - `interface YearReturn { year: number; returnPct: number; partial: boolean }`
  - `yearlyReturns(points: PricePoint[], now: Date): YearReturn[]` — ascending by year.
  - `formatPct(value: number): string`
  - Module-internal helpers `monthsBefore`, `pct`, `DAY_MS`, reused by Task 3 in the same file.

All functions assume `points` is sorted ascending by `t` (guaranteed by Task 1).

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/performance.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PricePoint } from '@/lib/history'
import { formatPct, periodReturns, yearlyReturns } from '@/lib/performance'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const p = (iso: string, close: number): PricePoint => ({ t: at(iso), close })
const NOW = new Date('2026-11-16T09:00:00Z')

describe('periodReturns', () => {
  const series = [
    p('2021-11-16', 50),
    p('2023-11-16', 80),
    p('2025-11-14', 100),
    p('2025-12-31', 110),
    p('2026-05-15', 120),
    p('2026-10-16', 125),
    p('2026-11-13', 150),
  ]

  it('measures each period against the last close on or before its start date', () => {
    const byKey = Object.fromEntries(periodReturns(series, NOW).map((r) => [r.key, r.returnPct]))
    expect(byKey['1M']).toBeCloseTo(20)
    expect(byKey['6M']).toBeCloseTo(25)
    expect(byKey.YTD).toBeCloseTo((150 / 110 - 1) * 100)
    expect(byKey['1A']).toBeCloseTo(50)
    expect(byKey['3A']).toBeCloseTo(87.5)
    expect(byKey['5A']).toBeCloseTo(200)
    expect(byKey.MAX).toBeCloseTo(200)
  })

  it('omits periods longer than the history and keeps a fixed order', () => {
    expect(periodReturns(series, NOW).map((r) => r.key)).toEqual(['1M', '6M', 'YTD', '1A', '3A', '5A', 'MAX'])
  })

  it('clamps the start date to the end of a shorter month', () => {
    const points = [p('2024-02-28', 90), p('2024-02-29', 100), p('2024-03-01', 105), p('2024-03-28', 110)]
    const oneMonth = periodReturns(points, new Date('2024-03-31T09:00:00Z')).find((r) => r.key === '1M')
    expect(oneMonth?.returnPct).toBeCloseTo(10)
  })

  it('omits short periods when the last close is older than their start date', () => {
    const stale = [p('2025-06-02', 10), p('2025-12-30', 20), p('2026-01-09', 30)]
    expect(periodReturns(stale, NOW).map((r) => r.key)).toEqual(['YTD', '1A', 'MAX'])
  })

  it('works on mixed-step series by date, not by index', () => {
    const mixed = [p('2016-10-31', 10), p('2016-11-30', 20), p('2026-11-12', 38), p('2026-11-13', 40)]
    const tenYears = periodReturns(mixed, NOW).find((r) => r.key === '10A')
    expect(tenYears?.returnPct).toBeCloseTo(300)
  })

  it('returns nothing for an empty or single-point series', () => {
    expect(periodReturns([], NOW)).toEqual([])
    expect(periodReturns([p('2026-11-13', 10)], NOW)).toEqual([])
  })

  it('skips a period whose reference close is not positive', () => {
    const points = [p('2020-01-02', 0), p('2026-11-13', 10)]
    expect(periodReturns(points, NOW)).toEqual([])
  })
})

describe('yearlyReturns', () => {
  it('compares each year-end close with the previous year-end close', () => {
    const points = [p('2023-06-01', 100), p('2023-12-29', 120), p('2024-12-31', 90), p('2025-12-31', 135), p('2026-11-13', 150)]
    const years = yearlyReturns(points, NOW)
    expect(years.map((y) => y.year)).toEqual([2023, 2024, 2025, 2026])
    expect(years[0]).toMatchObject({ partial: true })
    expect(years[0].returnPct).toBeCloseTo(20)
    expect(years[1]).toMatchObject({ partial: false })
    expect(years[1].returnPct).toBeCloseTo(-25)
    expect(years[2].returnPct).toBeCloseTo(50)
    expect(years[3]).toMatchObject({ partial: true })
    expect(years[3].returnPct).toBeCloseTo((150 / 135 - 1) * 100)
  })

  it('uses the latest earlier close when a calendar year has no data', () => {
    const points = [p('2020-01-02', 80), p('2020-12-31', 100), p('2022-12-30', 150)]
    const years = yearlyReturns(points, NOW)
    expect(years.map((y) => y.year)).toEqual([2020, 2022])
    expect(years[1].returnPct).toBeCloseTo(50)
    expect(years[1].partial).toBe(false)
  })

  it('skips a first year that has a single close', () => {
    const points = [p('2023-12-29', 100), p('2024-12-31', 110)]
    expect(yearlyReturns(points, NOW)).toEqual([{ year: 2024, returnPct: expect.closeTo(10), partial: false }])
  })

  it('returns nothing for an empty series', () => {
    expect(yearlyReturns([], NOW)).toEqual([])
  })
})

describe('formatPct', () => {
  it('uses an Italian decimal comma, one decimal and an explicit sign', () => {
    expect(formatPct(12.34)).toBe('+12,3%')
    expect(formatPct(-66.04)).toBe('−66,0%')
  })

  it('never shows a signed zero', () => {
    expect(formatPct(0)).toBe('0,0%')
    expect(formatPct(-0.04)).toBe('0,0%')
  })

  it('drops decimals and groups thousands for extreme returns', () => {
    expect(formatPct(412345.6)).toBe('+412.346%')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/performance.test.ts`
Expected: FAIL — cannot resolve `@/lib/performance`.

- [ ] **Step 3: Implement**

Create `lib/performance.ts`:

```ts
import type { PricePoint } from '@/lib/history'

const DAY_MS = 86_400_000

export type PeriodKey = '1M' | '6M' | 'YTD' | '1A' | '3A' | '5A' | '10A' | '20A' | 'MAX'

export interface PeriodReturn {
  key: PeriodKey
  returnPct: number
}

export interface YearReturn {
  year: number
  returnPct: number
  partial: boolean
}

function pct(value: number, reference: number): number {
  return (value / reference - 1) * 100
}

// Last millisecond of the UTC day `months` before `now`; 31 March minus one month is the last day of February.
function monthsBefore(now: Date, months: number): number {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() - months
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Date.UTC(year, month, Math.min(now.getUTCDate(), lastDay)) + DAY_MS - 1
}

function lastIndexAtOrBefore(points: PricePoint[], cutoff: number): number {
  let lo = 0
  let hi = points.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= cutoff) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

// Price return of the latest close over each horizon. Horizons the series does not reach back to are left out.
export function periodReturns(points: PricePoint[], now: Date): PeriodReturn[] {
  if (points.length < 2) return []
  const lastIndex = points.length - 1
  const last = points[lastIndex].close
  const out: PeriodReturn[] = []
  const add = (key: PeriodKey, refIndex: number) => {
    // refIndex === lastIndex means the latest close is older than the horizon start: nothing to measure.
    if (refIndex < 0 || refIndex >= lastIndex) return
    const reference = points[refIndex].close
    if (reference > 0) out.push({ key, returnPct: pct(last, reference) })
  }
  const cutoffs: Array<[PeriodKey, number]> = [
    ['1M', monthsBefore(now, 1)],
    ['6M', monthsBefore(now, 6)],
    ['YTD', Date.UTC(now.getUTCFullYear(), 0, 1) - 1],
    ['1A', monthsBefore(now, 12)],
    ['3A', monthsBefore(now, 36)],
    ['5A', monthsBefore(now, 60)],
    ['10A', monthsBefore(now, 120)],
    ['20A', monthsBefore(now, 240)],
  ]
  for (const [key, cutoff] of cutoffs) add(key, lastIndexAtOrBefore(points, cutoff))
  add('MAX', 0)
  return out
}

// One entry per calendar year with data. The listing year and the year of `now` are flagged partial.
export function yearlyReturns(points: PricePoint[], now: Date): YearReturn[] {
  const currentYear = now.getUTCFullYear()
  const out: YearReturn[] = []
  let previousClose: number | null = null
  let i = 0
  while (i < points.length) {
    const year = new Date(points[i].t).getUTCFullYear()
    let j = i
    while (j + 1 < points.length && new Date(points[j + 1].t).getUTCFullYear() === year) j++
    const first = previousClose === null
    const reference = previousClose ?? points[i].close
    const hasRange = !first || j > i
    if (year <= currentYear && reference > 0 && hasRange) {
      out.push({ year, returnPct: pct(points[j].close, reference), partial: first || year === currentYear })
    }
    previousClose = points[j].close
    i = j + 1
  }
  return out
}

export function formatPct(value: number): string {
  const digits = Math.abs(value) >= 1000 ? 0 : 1
  const rounded = Number(value.toFixed(digits))
  const body = Math.abs(rounded).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${body}%`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/performance.test.ts`
Expected: PASS, 14 tests.

If `skips a first year that has a single close` fails only because `expect.closeTo` is unavailable in this Vitest version, replace that assertion with:

```ts
    const years = yearlyReturns(points, NOW)
    expect(years).toHaveLength(1)
    expect(years[0]).toMatchObject({ year: 2024, partial: false })
    expect(years[0].returnPct).toBeCloseTo(10)
```

- [ ] **Step 5: Commit**

```bash
git add lib/performance.ts tests/lib/performance.test.ts
git commit -m "feat: add period and calendar-year return calculations"
```

---

### Task 3: Drawdown and series reduction

**Files:**
- Modify: `lib/performance.ts` (append)
- Test: `tests/lib/performance.test.ts` (append)

**Interfaces:**
- Consumes: `pct`, `monthsBefore`, `DAY_MS` already defined in `lib/performance.ts` by Task 2.
- Produces:
  - `interface DrawdownPoint { t: number; drawdownPct: number }` (`drawdownPct` is 0 or negative)
  - `drawdownSeries(points: PricePoint[]): DrawdownPoint[]`
  - `interface DrawdownSummary { currentPct: number; peakT: number; daysSincePeak: number; maxPct: number; maxPeakT: number; maxTroughT: number }`
  - `drawdownSummary(points: PricePoint[], now: Date): DrawdownSummary | null` — `null` with fewer than two points.
  - `downsample<T extends { t: number }>(points: T[], now: Date): T[]`

- [ ] **Step 1: Write the failing tests**

In `tests/lib/performance.test.ts`, change the import line to:

```ts
import { downsample, drawdownSeries, drawdownSummary, formatPct, periodReturns, yearlyReturns } from '@/lib/performance'
```

and append at the end of the file:

```ts
describe('drawdownSeries', () => {
  it('measures each close against the highest close so far', () => {
    const points = [p('2026-01-05', 100), p('2026-02-02', 120), p('2026-03-02', 60), p('2026-04-01', 90), p('2026-05-04', 130), p('2026-06-01', 117)]
    const series = drawdownSeries(points)
    expect(series.map((d) => d.t)).toEqual(points.map((x) => x.t))
    const expected = [0, 0, -50, -25, 0, -10]
    series.forEach((d, i) => expect(d.drawdownPct).toBeCloseTo(expected[i]))
  })

  it('returns an empty series for no points', () => {
    expect(drawdownSeries([])).toEqual([])
  })
})

describe('drawdownSummary', () => {
  it('reports the current drawdown and the deepest one with its dates', () => {
    const points = [p('2026-01-05', 100), p('2026-02-02', 120), p('2026-03-02', 60), p('2026-04-01', 90), p('2026-10-05', 130), p('2026-11-13', 117)]
    const summary = drawdownSummary(points, NOW)!
    expect(summary.currentPct).toBeCloseTo(-10)
    expect(summary.peakT).toBe(at('2026-10-05'))
    expect(summary.daysSincePeak).toBe(42)
    expect(summary.maxPct).toBeCloseTo(-50)
    expect(summary.maxPeakT).toBe(at('2026-02-02'))
    expect(summary.maxTroughT).toBe(at('2026-03-02'))
  })

  it('reports zero current drawdown when the last close is the high', () => {
    const summary = drawdownSummary([p('2026-01-05', 100), p('2026-02-02', 80), p('2026-11-13', 120)], NOW)!
    expect(summary.currentPct).toBe(0)
    expect(summary.peakT).toBe(at('2026-11-13'))
    expect(summary.maxPct).toBeCloseTo(-20)
  })

  it('reports no historical drawdown for a series that only rises', () => {
    const summary = drawdownSummary([p('2026-01-05', 1), p('2026-02-02', 2), p('2026-03-02', 3)], NOW)!
    expect(summary.maxPct).toBe(0)
    expect(summary.currentPct).toBe(0)
  })

  it('measures from the most recent time the high was touched', () => {
    const summary = drawdownSummary([p('2026-01-05', 100), p('2026-06-01', 100), p('2026-11-13', 90)], NOW)!
    expect(summary.peakT).toBe(at('2026-06-01'))
  })

  it('returns null with fewer than two points', () => {
    expect(drawdownSummary([], NOW)).toBeNull()
    expect(drawdownSummary([p('2026-11-13', 10)], NOW)).toBeNull()
  })
})

describe('downsample', () => {
  it('keeps the last point of each week before the five-year mark and every point after it', () => {
    const old = ['2020-01-06', '2020-01-07', '2020-01-08', '2020-01-09', '2020-01-10', '2020-01-13', '2020-01-14', '2020-01-17'].map((d, i) => p(d, i + 1))
    const recent = [p('2026-11-11', 50), p('2026-11-12', 51), p('2026-11-13', 52)]
    const out = downsample([...old, ...recent], NOW)
    expect(out.map((x) => x.close)).toEqual([5, 8, 50, 51, 52])
  })

  it('preserves the extra fields of the points it keeps', () => {
    const series = [{ t: at('2019-03-04'), drawdownPct: -1 }, { t: at('2019-03-05'), drawdownPct: -2 }]
    expect(downsample(series, NOW)).toEqual([{ t: at('2019-03-05'), drawdownPct: -2 }])
  })

  it('returns an empty list for no points', () => {
    expect(downsample([], NOW)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/performance.test.ts`
Expected: FAIL — `downsample`, `drawdownSeries`, `drawdownSummary` are not exported.

- [ ] **Step 3: Implement**

Append to `lib/performance.ts`:

```ts
export interface DrawdownPoint {
  t: number
  drawdownPct: number
}

export interface DrawdownSummary {
  currentPct: number
  peakT: number
  daysSincePeak: number
  maxPct: number
  maxPeakT: number
  maxTroughT: number
}

// Distance of each close from the highest close reached up to that point (0 or negative).
export function drawdownSeries(points: PricePoint[]): DrawdownPoint[] {
  let peak = 0
  return points.map((p) => {
    if (p.close > peak) peak = p.close
    return { t: p.t, drawdownPct: peak > 0 ? pct(p.close, peak) : 0 }
  })
}

export function drawdownSummary(points: PricePoint[], now: Date): DrawdownSummary | null {
  if (points.length < 2) return null
  let peak = points[0]
  let maxPct = 0
  let maxPeakT = points[0].t
  let maxTroughT = points[0].t
  for (const p of points) {
    // >= so the current drawdown is dated from the latest time the high was touched.
    if (p.close >= peak.close) {
      peak = p
    } else if (peak.close > 0) {
      const drawdown = pct(p.close, peak.close)
      if (drawdown < maxPct) {
        maxPct = drawdown
        maxPeakT = peak.t
        maxTroughT = p.t
      }
    }
  }
  const last = points[points.length - 1]
  return {
    currentPct: last === peak || peak.close <= 0 ? 0 : pct(last.close, peak.close),
    peakT: peak.t,
    daysSincePeak: Math.max(0, Math.floor(now.getTime() / DAY_MS) - Math.floor(peak.t / DAY_MS)),
    maxPct,
    maxPeakT,
    maxTroughT,
  }
}

// Series for the browser: every point of the last five years, one per week (its last) before that.
export function downsample<T extends { t: number }>(points: T[], now: Date): T[] {
  const cutoff = monthsBefore(now, 60)
  const out: T[] = []
  let week: number | null = null
  for (const p of points) {
    if (p.t > cutoff) {
      out.push(p)
      continue
    }
    // 1 January 1970 was a Thursday; +3 makes weeks roll over on Monday.
    const w = Math.floor((p.t / DAY_MS + 3) / 7)
    if (w === week) out[out.length - 1] = p
    else out.push(p)
    week = w
  }
  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/performance.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add lib/performance.ts tests/lib/performance.test.ts
git commit -m "feat: add drawdown series, drawdown summary and series downsampling"
```

---

### Task 4: Performance tiles and yearly returns chart

**Files:**
- Create: `components/PerformanceTiles.tsx`, `components/PerformanceTiles.module.css`
- Create: `components/YearlyReturnsChart.tsx`, `components/YearlyReturnsChart.module.css`
- Test: `tests/components/PerformanceTiles.test.tsx`, `tests/components/YearlyReturnsChart.test.tsx` (create)

**Interfaces:**
- Consumes from `@/lib/performance`: `formatPct(value: number): string`, `type PeriodKey`, `interface PeriodReturn { key: PeriodKey; returnPct: number }`, `interface YearReturn { year: number; returnPct: number; partial: boolean }`.
- Produces:
  - `PerformanceTiles({ returns }: { returns: PeriodReturn[] })` — renders nothing when `returns` is empty.
  - `YearlyReturnsChart({ years }: { years: YearReturn[] })` — renders nothing when `years` is empty.

Both are server components (no `'use client'`, no state). Gain/loss tone is exposed as a `data-tone="gain" | "loss"` attribute, which the CSS selects on and the tests assert on (CSS-module class names are not stable in tests).

- [ ] **Step 1: Write the failing tests**

Create `tests/components/PerformanceTiles.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PerformanceTiles } from '@/components/PerformanceTiles'

describe('PerformanceTiles', () => {
  it('renders one labelled tile per period with a signed percentage', () => {
    render(
      <PerformanceTiles
        returns={[
          { key: '1M', returnPct: 12.34 },
          { key: 'YTD', returnPct: -8.5 },
          { key: 'MAX', returnPct: 412345.6 },
        ]}
      />,
    )
    expect(screen.getByText('1 mese')).toBeInTheDocument()
    expect(screen.getByText('+12,3%')).toHaveAttribute('data-tone', 'gain')
    expect(screen.getByText('Da inizio anno')).toBeInTheDocument()
    expect(screen.getByText('−8,5%')).toHaveAttribute('data-tone', 'loss')
    expect(screen.getByText('Tutto lo storico')).toBeInTheDocument()
    expect(screen.getByText('+412.346%')).toBeInTheDocument()
  })

  it('does not render periods that were omitted from the calculation', () => {
    render(<PerformanceTiles returns={[{ key: '1A', returnPct: 5 }]} />)
    expect(screen.getByText('1 anno')).toBeInTheDocument()
    expect(screen.queryByText('20 anni')).not.toBeInTheDocument()
    expect(screen.queryByText('10 anni')).not.toBeInTheDocument()
  })

  it('renders nothing without returns', () => {
    const { container } = render(<PerformanceTiles returns={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

Create `tests/components/YearlyReturnsChart.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { YearlyReturnsChart } from '@/components/YearlyReturnsChart'

const YEARS = [
  { year: 2023, returnPct: 20, partial: true },
  { year: 2024, returnPct: -25, partial: false },
  { year: 2025, returnPct: 50, partial: false },
  { year: 2026, returnPct: 11.1, partial: true },
]

describe('YearlyReturnsChart', () => {
  it('draws one bar per year, toned by sign, with partial years marked', () => {
    const { container } = render(<YearlyReturnsChart years={YEARS} />)
    const bars = container.querySelectorAll('rect[data-tone]')
    expect(bars).toHaveLength(4)
    expect(bars[0]).toHaveAttribute('data-tone', 'gain')
    expect(bars[1]).toHaveAttribute('data-tone', 'loss')
    expect(bars[0]).toHaveAttribute('data-partial', 'true')
    expect(bars[1]).toHaveAttribute('data-partial', 'false')
    const titles = Array.from(container.querySelectorAll('title')).map((t) => t.textContent)
    expect(titles).toEqual(['2023: +20,0% (parziale)', '2024: −25,0%', '2025: +50,0%', '2026: +11,1% (parziale)'])
  })

  it('summarises the chart in its accessible name and in visible text', () => {
    render(<YearlyReturnsChart years={YEARS} />)
    expect(screen.getByRole('img', { name: /dal 2023 al 2026: 3 anni positivi su 4/i })).toBeInTheDocument()
    expect(screen.getByText(/Migliore: 2025 \(\+50,0%\)/)).toBeInTheDocument()
    expect(screen.getByText(/Peggiore: 2024 \(−25,0%\)/)).toBeInTheDocument()
    expect(screen.getByText(/anno parziale/i)).toBeInTheDocument()
  })

  it('renders without NaN when every return is zero', () => {
    const { container } = render(<YearlyReturnsChart years={[{ year: 2025, returnPct: 0, partial: false }, { year: 2026, returnPct: 0, partial: true }]} />)
    expect(container.innerHTML).not.toContain('NaN')
    expect(container.querySelectorAll('rect[data-tone]')).toHaveLength(2)
  })

  it('thins year labels on very long histories', () => {
    const many = Array.from({ length: 64 }, (_, i) => ({ year: 1963 + i, returnPct: i % 2 ? 5 : -5, partial: false }))
    const { container } = render(<YearlyReturnsChart years={many} />)
    const labels = Array.from(container.querySelectorAll('text')).map((t) => t.textContent)
    expect(labels.length).toBeLessThanOrEqual(10)
    expect(labels).toContain('2026')
    expect(container.querySelectorAll('rect[data-tone]')).toHaveLength(64)
  })

  it('renders nothing without years', () => {
    const { container } = render(<YearlyReturnsChart years={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/PerformanceTiles.test.tsx tests/components/YearlyReturnsChart.test.tsx`
Expected: FAIL — cannot resolve `@/components/PerformanceTiles` and `@/components/YearlyReturnsChart`.

- [ ] **Step 3: Implement the tiles**

Create `components/PerformanceTiles.tsx`:

```tsx
import { formatPct, type PeriodKey, type PeriodReturn } from '@/lib/performance'
import styles from './PerformanceTiles.module.css'

const LABELS: Record<PeriodKey, string> = {
  '1M': '1 mese',
  '6M': '6 mesi',
  YTD: 'Da inizio anno',
  '1A': '1 anno',
  '3A': '3 anni',
  '5A': '5 anni',
  '10A': '10 anni',
  '20A': '20 anni',
  MAX: 'Tutto lo storico',
}

export function PerformanceTiles({ returns }: { returns: PeriodReturn[] }) {
  if (returns.length === 0) return null
  return (
    <dl className={styles.grid}>
      {returns.map((r) => (
        <div key={r.key} className={styles.tile}>
          <dt className={styles.label}>{LABELS[r.key]}</dt>
          <dd className={styles.value} data-tone={r.returnPct >= 0 ? 'gain' : 'loss'}>
            {formatPct(r.returnPct)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
```

Create `components/PerformanceTiles.module.css`:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
  margin: 0;
}

.tile {
  min-width: 0;
  padding: 10px 12px;
  border-radius: var(--radius-inner);
  background: var(--surface-raised);
}

.label {
  font-size: 12px;
  color: var(--muted);
}

.value {
  margin: 2px 0 0;
  font-size: 17px;
  font-weight: 600;
  font-feature-settings: "tnum" 1;
  overflow-wrap: anywhere;
}

.value[data-tone='gain'] {
  color: var(--gain-bright);
}

.value[data-tone='loss'] {
  color: var(--loss-bright);
}
```

- [ ] **Step 4: Implement the yearly chart**

Create `components/YearlyReturnsChart.tsx`:

```tsx
import { formatPct, type YearReturn } from '@/lib/performance'
import styles from './YearlyReturnsChart.module.css'

const W = 640
const H = 200
const PAD = { top: 12, right: 8, bottom: 22, left: 8 }
const MAX_LABELS = 10

export function YearlyReturnsChart({ years }: { years: YearReturn[] }) {
  if (years.length === 0) return null

  const max = Math.max(0, ...years.map((y) => y.returnPct))
  const min = Math.min(0, ...years.map((y) => y.returnPct))
  const span = max - min || 1
  const plotH = H - PAD.top - PAD.bottom
  const y = (v: number) => PAD.top + ((max - v) / span) * plotH
  const slot = (W - PAD.left - PAD.right) / years.length
  const barW = Math.min(36, slot * 0.7)
  const labelStep = Math.ceil(years.length / MAX_LABELS)

  const best = years.reduce((a, b) => (b.returnPct > a.returnPct ? b : a))
  const worst = years.reduce((a, b) => (b.returnPct < a.returnPct ? b : a))
  const positive = years.filter((v) => v.returnPct > 0).length
  const describe = (v: YearReturn) => `${v.year} (${formatPct(v.returnPct)})`
  const label = `Rendimento anno per anno dal ${years[0].year} al ${years[years.length - 1].year}: ${positive} anni positivi su ${years.length}. Migliore ${describe(best)}, peggiore ${describe(worst)}.`

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={label}>
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className={styles.zero} />
        {years.map((v, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2
          const top = y(Math.max(v.returnPct, 0))
          const height = Math.max(1, Math.abs(y(v.returnPct) - y(0)))
          return (
            <rect key={v.year} x={x} y={top} width={barW} height={height} rx={2} className={styles.bar} data-tone={v.returnPct >= 0 ? 'gain' : 'loss'} data-partial={v.partial ? 'true' : 'false'}>
              <title>{`${v.year}: ${formatPct(v.returnPct)}${v.partial ? ' (parziale)' : ''}`}</title>
            </rect>
          )
        })}
        {years.map((v, i) =>
          (years.length - 1 - i) % labelStep === 0 ? (
            <text key={v.year} x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" className={styles.axis}>
              {v.year}
            </text>
          ) : null,
        )}
      </svg>
      <p className={styles.note}>
        Migliore: {describe(best)} · Peggiore: {describe(worst)}
        {years.some((v) => v.partial) && ' · Barre attenuate: anno parziale'}
      </p>
    </div>
  )
}
```

Create `components/YearlyReturnsChart.module.css`:

```css
.svg {
  display: block;
  width: 100%;
  height: auto;
}

.zero {
  stroke: var(--rule);
  stroke-width: 1;
}

.bar[data-tone='gain'] {
  fill: var(--gain-bright);
}

.bar[data-tone='loss'] {
  fill: var(--loss-bright);
}

.bar[data-partial='true'] {
  opacity: 0.45;
}

.axis {
  font-size: 10px;
  fill: var(--muted);
}

.note {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/components/PerformanceTiles.test.tsx tests/components/YearlyReturnsChart.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add components/PerformanceTiles.tsx components/PerformanceTiles.module.css components/YearlyReturnsChart.tsx components/YearlyReturnsChart.module.css tests/components/PerformanceTiles.test.tsx tests/components/YearlyReturnsChart.test.tsx
git commit -m "feat: add performance tiles and yearly returns chart"
```

---

### Task 5: Drawdown chart

**Files:**
- Create: `components/DrawdownChart.tsx`, `components/DrawdownChart.module.css`
- Test: `tests/components/DrawdownChart.test.tsx` (create)

**Interfaces:**
- Consumes from `@/lib/performance`: `formatPct(value: number): string`, `interface DrawdownPoint { t: number; drawdownPct: number }`, `interface DrawdownSummary { currentPct: number; peakT: number; daysSincePeak: number; maxPct: number; maxPeakT: number; maxTroughT: number }`.
- Produces: `DrawdownChart({ series, summary }: { series: DrawdownPoint[]; summary: DrawdownSummary })` — server component. Always renders the summary sentence; renders the SVG only when `series` has at least two points.

The x axis is scaled by **time**, not by index, because the series can mix weekly and daily points.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/DrawdownChart.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DrawdownChart } from '@/components/DrawdownChart'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const SERIES = [
  { t: at('2021-11-19'), drawdownPct: 0 },
  { t: at('2022-10-14'), drawdownPct: -66 },
  { t: at('2026-10-05'), drawdownPct: 0 },
  { t: at('2026-11-13'), drawdownPct: -25 },
]
const SUMMARY = { currentPct: -25, peakT: at('2026-10-05'), daysSincePeak: 42, maxPct: -66, maxPeakT: at('2021-11-19'), maxTroughT: at('2022-10-14') }

describe('DrawdownChart', () => {
  it('states the current drawdown and the worst one in a sentence', () => {
    render(<DrawdownChart series={SERIES} summary={SUMMARY} />)
    expect(screen.getByText('Ora a −25,0% dal massimo del 5 ottobre 2026 (42 giorni fa). Crollo peggiore: −66,0%, da novembre 2021 a ottobre 2022.')).toBeInTheDocument()
  })

  it('uses the sentence as the accessible name of the chart', () => {
    render(<DrawdownChart series={SERIES} summary={SUMMARY} />)
    expect(screen.getByRole('img', { name: /Ora a −25,0% dal massimo del 5 ottobre 2026/ })).toBeInTheDocument()
  })

  it('says so when the stock is at its all-time high', () => {
    render(<DrawdownChart series={SERIES} summary={{ ...SUMMARY, currentPct: 0, daysSincePeak: 0 }} />)
    expect(screen.getByText('Sui massimi storici. Crollo peggiore: −66,0%, da novembre 2021 a ottobre 2022.')).toBeInTheDocument()
  })

  it('omits the worst drawdown when there has never been one', () => {
    render(<DrawdownChart series={SERIES} summary={{ ...SUMMARY, currentPct: 0, maxPct: 0 }} />)
    expect(screen.getByText('Sui massimi storici.')).toBeInTheDocument()
  })

  it('handles a peak one day ago and a drawdown within a single month', () => {
    render(<DrawdownChart series={SERIES} summary={{ ...SUMMARY, daysSincePeak: 1, maxPeakT: at('2022-10-03'), maxTroughT: at('2022-10-14') }} />)
    expect(screen.getByText('Ora a −25,0% dal massimo del 5 ottobre 2026 (1 giorno fa). Crollo peggiore: −66,0%, a ottobre 2022.')).toBeInTheDocument()
  })

  it('renders a flat series without NaN', () => {
    const flat = [{ t: at('2026-01-05'), drawdownPct: 0 }, { t: at('2026-11-13'), drawdownPct: 0 }]
    const { container } = render(<DrawdownChart series={flat} summary={{ ...SUMMARY, currentPct: 0, maxPct: 0 }} />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('renders points sharing one timestamp without NaN', () => {
    const same = [{ t: at('2026-11-13'), drawdownPct: 0 }, { t: at('2026-11-13'), drawdownPct: -5 }]
    const { container } = render(<DrawdownChart series={same} summary={SUMMARY} />)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('shows only the sentence when there is nothing to plot', () => {
    const { container } = render(<DrawdownChart series={[]} summary={SUMMARY} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText(/Ora a −25,0%/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/DrawdownChart.test.tsx`
Expected: FAIL — cannot resolve `@/components/DrawdownChart`.

- [ ] **Step 3: Implement**

Create `components/DrawdownChart.tsx`:

```tsx
import { formatPct, type DrawdownPoint, type DrawdownSummary } from '@/lib/performance'
import styles from './DrawdownChart.module.css'

const W = 640
const H = 180
const PAD = { top: 12, right: 8, bottom: 22, left: 8 }

const fmtDay = (t: number) => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const fmtMonth = (t: number) => new Date(t).toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const fmtYear = (t: number) => String(new Date(t).getUTCFullYear())

function sentence(s: DrawdownSummary): string {
  const from = fmtMonth(s.maxPeakT)
  const to = fmtMonth(s.maxTroughT)
  const worst = s.maxPct < 0 ? ` Crollo peggiore: ${formatPct(s.maxPct)}, ${from === to ? `a ${to}` : `da ${from} a ${to}`}.` : ''
  // Anything that would print as 0,0% counts as being at the high.
  if (s.currentPct > -0.05) return `Sui massimi storici.${worst}`
  const ago = s.daysSincePeak <= 0 ? 'oggi' : s.daysSincePeak === 1 ? '1 giorno fa' : `${s.daysSincePeak} giorni fa`
  return `Ora a ${formatPct(s.currentPct)} dal massimo del ${fmtDay(s.peakT)} (${ago}).${worst}`
}

export function DrawdownChart({ series, summary }: { series: DrawdownPoint[]; summary: DrawdownSummary }) {
  const text = sentence(summary)
  if (series.length < 2) return <p className={styles.summary}>{text}</p>

  const t0 = series[0].t
  const t1 = series[series.length - 1].t
  const spanT = t1 - t0 || 1
  const lowest = series.reduce((m, d) => Math.min(m, d.drawdownPct), 0)
  const floor = lowest < 0 ? lowest : -1
  const x = (t: number) => PAD.left + ((t - t0) / spanT) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (v / floor) * (H - PAD.top - PAD.bottom)
  const line = series.map((d) => `${x(d.t).toFixed(1)},${y(d.drawdownPct).toFixed(1)}`).join(' ')
  const area = `${x(t0).toFixed(1)},${y(0).toFixed(1)} ${line} ${x(t1).toFixed(1)},${y(0).toFixed(1)}`

  return (
    <div>
      <p className={styles.summary}>{text}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={text}>
        <polygon points={area} className={styles.area} />
        <polyline points={line} className={styles.line} fill="none" />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className={styles.zero} />
        <text x={PAD.left} y={H - 6} className={styles.axis}>
          {fmtYear(t0)}
        </text>
        <text x={W / 2} y={H - 6} textAnchor="middle" className={styles.axis}>
          minimo {formatPct(lowest)}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className={styles.axis}>
          {fmtYear(t1)}
        </text>
      </svg>
    </div>
  )
}
```

Create `components/DrawdownChart.module.css`:

```css
.summary {
  margin-bottom: 10px;
  font-size: 15px;
  line-height: 1.45;
  max-width: 70ch;
}

.svg {
  display: block;
  width: 100%;
  height: auto;
}

.area {
  fill: color-mix(in srgb, var(--loss-bright) 18%, transparent);
}

.line {
  stroke: var(--loss-bright);
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.zero {
  stroke: var(--rule);
  stroke-width: 1;
}

.axis {
  font-size: 10px;
  fill: var(--muted);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/DrawdownChart.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add components/DrawdownChart.tsx components/DrawdownChart.module.css tests/components/DrawdownChart.test.tsx
git commit -m "feat: add drawdown chart with summary sentence"
```

---

### Task 6: Long ranges on the price chart

**Files:**
- Modify: `components/PriceHistoryChart.tsx` (lines 12-38 and the two JSX spots shown below)
- Test: `tests/components/PriceHistoryChart.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks (it only receives plain `{ t, close }` points).
- Produces: `PriceHistoryChart({ points, intraday?, prevClose?, long? })` where `long?: Array<{ t: number; close: number }>` is the downsampled full history, ascending. Buttons: `5A` and `10A` appear only when `long` reaches back that far (7-day tolerance); `Max` appears when `long` has at least two points. Existing ranges and their behaviour are unchanged when `long` is omitted.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/PriceHistoryChart.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PriceHistoryChart } from '@/components/PriceHistoryChart'

const DAY = 86_400_000
const END = Date.UTC(2026, 10, 13, 14, 30)
// Ascending series ending at END, one point every `step` days, price rising by 1 per point from 10.
const series = (count: number, step: number) => Array.from({ length: count }, (_, i) => ({ t: END - (count - 1 - i) * step * DAY, close: 10 + i }))

const YEAR = series(250, 1)
const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent)

describe('PriceHistoryChart long ranges', () => {
  it('shows no long ranges without a long series', () => {
    render(<PriceHistoryChart points={YEAR} />)
    expect(tabs()).toEqual(['1M', '3M', '6M', 'YTD', '1A'])
  })

  it('shows 5A, 10A and Max when the long series covers them', () => {
    render(<PriceHistoryChart points={YEAR} long={series(12 * 52, 7)} />)
    expect(tabs()).toEqual(['1M', '3M', '6M', 'YTD', '1A', '5A', '10A', 'Max'])
  })

  it('hides the ranges the long series is too short for', () => {
    render(<PriceHistoryChart points={YEAR} long={series(6 * 52, 7)} />)
    expect(tabs()).toEqual(['1M', '3M', '6M', 'YTD', '1A', '5A', 'Max'])
  })

  it('shows only Max for a recently listed stock', () => {
    render(<PriceHistoryChart points={series(40, 1)} long={series(40, 1)} />)
    expect(tabs()).toEqual(['1M', '3M', '6M', 'YTD', '1A', 'Max'])
  })

  it('plots the whole long series on Max', () => {
    const long = series(12 * 52, 7)
    render(<PriceHistoryChart points={YEAR} long={long} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Max' }))
    expect(screen.getByRole('tab', { name: 'Max' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/da inizio storico/)).toBeInTheDocument()
    expect(screen.getByText(new Date(long[0].t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }))).toBeInTheDocument()
  })

  it('limits 5A to the last five years of the long series', () => {
    render(<PriceHistoryChart points={YEAR} long={series(12 * 52, 7)} />)
    fireEvent.click(screen.getByRole('tab', { name: '5A' }))
    expect(screen.getByText(/in 5 anni/)).toBeInTheDocument()
    expect(screen.getByText(/Minimo \$3\d\d\.00/)).toBeInTheDocument()
  })

  it('ends long ranges on the freshest daily close', () => {
    const long = series(12 * 52, 7).map((p) => ({ ...p, t: p.t - DAY }))
    render(<PriceHistoryChart points={[...YEAR.slice(0, -1), { t: END, close: 999 }]} long={long} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Max' }))
    expect(screen.getByText('$999.00')).toBeInTheDocument()
  })

  it('keeps the existing period wording for short ranges', () => {
    render(<PriceHistoryChart points={YEAR} />)
    expect(screen.getByText(/in 3 mesi/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '1M' }))
    expect(screen.getByText(/in 1 mese/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '1A' }))
    expect(screen.getByText(/in 1 anno/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'YTD' }))
    expect(screen.getByText(/da inizio anno/)).toBeInTheDocument()
  })
})
```

Note on `limits 5A…`: the long series has 624 weekly points priced 10…633; the last five years are roughly the last 261 points, so the minimum is about 373 and must start with `$3`. A chart that wrongly plotted all 12 years would show `Minimo $10.00`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/PriceHistoryChart.test.tsx`
Expected: FAIL — the tests that pass `long` find no `5A` / `10A` / `Max` tab; `shows no long ranges…` and `keeps the existing period wording…` pass already.

- [ ] **Step 3: Extend the ranges and the data selection**

In `components/PriceHistoryChart.tsx`, replace everything from `const RANGES = [` through the closing `}, [points, intraday, range])` of the `data` memo (the block that currently spans the `RANGES` constant, `W`/`H`/`PAD`, the function signature, the two `useState` calls and the `data` memo) with:

```tsx
const RANGES = [
  { key: '1G', days: 1 },
  { key: '1M', days: 30 },
  { key: '3M', days: 91 },
  { key: '6M', days: 182 },
  { key: 'YTD', days: 0 },
  { key: '1A', days: 365 },
  { key: '5A', days: 1826 },
  { key: '10A', days: 3652 },
  { key: 'Max', days: 0 },
] as const

type RangeKey = (typeof RANGES)[number]['key']

const LONG_RANGES: readonly RangeKey[] = ['5A', '10A', 'Max']
const PERIOD_TEXT: Record<Exclude<RangeKey, '1G'>, string> = {
  '1M': 'in 1 mese',
  '3M': 'in 3 mesi',
  '6M': 'in 6 mesi',
  YTD: 'da inizio anno',
  '1A': 'in 1 anno',
  '5A': 'in 5 anni',
  '10A': 'in 10 anni',
  Max: 'da inizio storico',
}

const DAY_MS = 86_400_000
// A range is offered when the series starts within a week of where the range would begin.
const COVERAGE_SLACK_DAYS = 7
const W = 640
const H = 220
const PAD = { top: 12, right: 8, bottom: 22, left: 8 }

export function PriceHistoryChart({ points, intraday = [], prevClose = null, long = [] }: { points: Point[]; intraday?: Point[]; prevClose?: number | null; long?: Point[] }) {
  const [range, setRange] = useState<RangeKey>(intraday.length > 1 ? '1G' : '3M')
  const [hover, setHover] = useState<number | null>(null)

  const ranges = useMemo(
    () =>
      RANGES.filter((r) => {
        if (r.key === '1G') return intraday.length > 0
        if (r.key === 'Max') return long.length > 1
        if (r.key === '5A' || r.key === '10A') return long.length > 1 && long[0].t <= long[long.length - 1].t - (r.days - COVERAGE_SLACK_DAYS) * DAY_MS
        return true
      }),
    [intraday, long],
  )

  const data = useMemo(() => {
    if (range === '1G') return intraday
    let base = points
    if (LONG_RANGES.includes(range)) {
      // The long series is cached for hours; finish it with the freshest daily close.
      const tail = points[points.length - 1]
      base = tail && long.length > 0 && tail.t > long[long.length - 1].t ? [...long, tail] : long
    }
    if (base.length === 0) return []
    if (range === 'Max') return base
    const last = base[base.length - 1].t
    if (range === 'YTD') {
      const yearStart = Date.UTC(new Date(last).getUTCFullYear(), 0, 1)
      return base.filter((p) => p.t >= yearStart)
    }
    const days = RANGES.find((r) => r.key === range)!.days
    return base.filter((p) => p.t >= last - days * DAY_MS)
  }, [points, intraday, long, range])
```

- [ ] **Step 4: Update the two JSX spots**

Still in `components/PriceHistoryChart.tsx`, in the `<p className={styles.sub}>` expression, replace the trailing branch

```tsx
: `${up ? '+' : ''}${changePct.toFixed(1)}% ${range === 'YTD' ? 'da inizio anno' : `in ${range === '1A' ? '1 anno' : range.replace('M', ' mesi').replace('1 mesi', '1 mese')}`}`}
```

with

```tsx
: `${up ? '+' : ''}${changePct.toFixed(1)}% ${PERIOD_TEXT[range as Exclude<RangeKey, '1G'>]}`}
```

and replace

```tsx
          {RANGES.filter((r) => r.key !== '1G' || intraday.length > 0).map((r) => (
```

with

```tsx
          {ranges.map((r) => (
```

Leave the rest of the component (scales, hover, SVG) untouched.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/components/PriceHistoryChart.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/PriceHistoryChart.tsx tests/components/PriceHistoryChart.test.tsx
git commit -m "feat: add 5A, 10A and Max ranges to the price history chart"
```

---

### Task 7: Performance panel, "Andamento" tab and page wiring

**Files:**
- Create: `components/PerformancePanel.tsx`, `components/PerformancePanel.module.css`
- Modify: `app/stock/[symbol]/page.tsx` (imports at lines 1-38; `StockPreview` data fetch near line 122 and chart near line 182; `StockDetail` data fetch near line 261, chart near line 393, tabs near line 473)
- Test: `tests/components/PerformancePanel.test.tsx` (create)

**Interfaces:**
- Consumes:
  - from `@/lib/history`: `getFullPriceHistory(symbol: string): Promise<FullHistory>`, `interface FullHistory { points: PricePoint[]; sparseBefore: number | null }`
  - from `@/lib/performance`: `periodReturns(points, now)`, `yearlyReturns(points, now)`, `drawdownSeries(points)`, `drawdownSummary(points, now)`, `downsample(points, now)`
  - components `PerformanceTiles({ returns })`, `YearlyReturnsChart({ years })`, `DrawdownChart({ series, summary })`
  - `PriceHistoryChart`'s `long` prop from Task 6
- Produces: `PerformancePanel({ history, now }: { history: FullHistory; now: Date })` — server component.

- [ ] **Step 1: Read the Next.js docs this task touches**

Run: `ls node_modules/next/dist/docs/ && grep -rln "connection()" node_modules/next/dist/docs | head`
Read the guide covering `connection()` and current-time access under `cacheComponents`. Confirm that reading `new Date()` in an async server component after `await connection()` is the supported pattern in this version. If the docs prescribe something different, follow the docs and adapt Steps 6 and 7 accordingly.

- [ ] **Step 2: Write the failing test**

Create `tests/components/PerformancePanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PerformancePanel } from '@/components/PerformancePanel'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const NOW = new Date('2026-11-16T09:00:00Z')
const POINTS = [
  { t: at('2024-06-03'), close: 100 },
  { t: at('2024-12-31'), close: 120 },
  { t: at('2025-12-31'), close: 90 },
  { t: at('2026-10-05'), close: 160 },
  { t: at('2026-11-13'), close: 120 },
]

describe('PerformancePanel', () => {
  it('renders the three blocks from a price history', () => {
    render(<PerformancePanel history={{ points: POINTS, sparseBefore: null }} now={NOW} />)
    expect(screen.getByRole('heading', { name: 'Performance per periodo' })).toBeInTheDocument()
    expect(screen.getByText('Tutto lo storico')).toBeInTheDocument()
    expect(screen.getByText('+20,0%')).toBeInTheDocument()
    expect(screen.queryByText('5 anni')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Anno per anno' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /dal 2024 al 2026/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Distanza dai massimi' })).toBeInTheDocument()
    expect(screen.getByText(/Ora a −25,0% dal massimo del 5 ottobre 2026 \(42 giorni fa\)\. Crollo peggiore: −25,0%/)).toBeInTheDocument()
    expect(screen.getByText(/corretti per gli split, dividendi esclusi/)).toBeInTheDocument()
    expect(screen.queryByText(/meno fitti/)).not.toBeInTheDocument()
  })

  it('shows the unavailable message without a history', () => {
    render(<PerformancePanel history={{ points: [], sparseBefore: null }} now={NOW} />)
    expect(screen.getByText('Storico non disponibile al momento.')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('shows the unavailable message with a single close', () => {
    render(<PerformancePanel history={{ points: POINTS.slice(0, 1), sparseBefore: null }} now={NOW} />)
    expect(screen.getByText('Storico non disponibile al momento.')).toBeInTheDocument()
  })

  it('warns when old data is sparser than daily', () => {
    render(<PerformancePanel history={{ points: POINTS, sparseBefore: at('2016-11-16') }} now={NOW} />)
    expect(screen.getByText(/Prima del 16 novembre 2016 i dati sono meno fitti/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/components/PerformancePanel.test.tsx`
Expected: FAIL — cannot resolve `@/components/PerformancePanel`.

- [ ] **Step 4: Implement the panel**

Create `components/PerformancePanel.tsx`:

```tsx
import type { FullHistory } from '@/lib/history'
import { downsample, drawdownSeries, drawdownSummary, periodReturns, yearlyReturns } from '@/lib/performance'
import { DrawdownChart } from '@/components/DrawdownChart'
import { PerformanceTiles } from '@/components/PerformanceTiles'
import { YearlyReturnsChart } from '@/components/YearlyReturnsChart'
import styles from './PerformancePanel.module.css'

export function PerformancePanel({ history, now }: { history: FullHistory; now: Date }) {
  const { points, sparseBefore } = history
  const summary = drawdownSummary(points, now)
  if (!summary) return <p className={styles.empty}>Storico non disponibile al momento.</p>

  return (
    <div className={styles.panel}>
      <section className={styles.card} aria-labelledby="performance-title">
        <h2 id="performance-title" className={styles.title}>
          Performance per periodo
        </h2>
        <PerformanceTiles returns={periodReturns(points, now)} />
      </section>
      <section className={styles.card} aria-labelledby="yearly-title">
        <h2 id="yearly-title" className={styles.title}>
          Anno per anno
        </h2>
        <YearlyReturnsChart years={yearlyReturns(points, now)} />
      </section>
      <section className={styles.card} aria-labelledby="drawdown-title">
        <h2 id="drawdown-title" className={styles.title}>
          Distanza dai massimi
        </h2>
        <DrawdownChart series={downsample(drawdownSeries(points), now)} summary={summary} />
      </section>
      <p className={styles.note}>
        Prezzi di chiusura corretti per gli split, dividendi esclusi. Fonte: Yahoo Finance.
        {sparseBefore !== null &&
          ` Prima del ${new Date(sparseBefore).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} i dati sono meno fitti di quelli giornalieri: i crolli di quel periodo possono risultare meno profondi di quanto sono stati.`}
      </p>
    </div>
  )
}
```

Create `components/PerformancePanel.module.css`:

```css
.panel {
  display: grid;
  gap: 16px;
  margin-top: 24px;
  min-width: 0;
}

.card {
  min-width: 0;
  padding: 20px 20px 16px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--card-shadow);
}

.title {
  margin-bottom: 12px;
  font-size: 17px;
  font-weight: 600;
}

.note,
.empty {
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted);
  max-width: 75ch;
}

.empty {
  margin-top: 24px;
  font-size: 15px;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/components/PerformancePanel.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Wire the watched-stock page (`StockDetail`)**

In `app/stock/[symbol]/page.tsx`:

Change the history import and add two imports next to the other component/lib imports:

```tsx
import { getFullPriceHistory, getIntradayHistory, getPriceHistory } from '@/lib/history'
import { PerformancePanel } from '@/components/PerformancePanel'
import { downsample } from '@/lib/performance'
```

In `StockDetail` (which already starts with `await connection()`), extend the existing `Promise.all`:

```tsx
  const [history, intraday, videos, insiders, congress, financials, metrics, fullHistory] = await Promise.all([
    getPriceHistory(stock.symbol),
    getIntradayHistory(stock.symbol),
    getRecentVideos(stock.symbol, stock.name),
    getInsiderData(stock.symbol),
    getCongressTrades(stock.symbol),
    getAnnualFinancials(stock.symbol),
    getMetrics(stock.symbol).catch(() => null),
    getFullPriceHistory(stock.symbol),
  ])
  const now = new Date()
  const longHistory = downsample(fullHistory.points, now)
```

Pass the long series to the chart inside the `price-title` section:

```tsx
                <PriceHistoryChart points={history} intraday={intraday.points} prevClose={intraday.prevClose} long={longHistory} />
```

Add the tab to the `StockTabs` array, immediately after the `valutazione` entry and before `bilanci`:

```tsx
          {
            id: 'andamento',
            label: 'Andamento',
            content: <PerformancePanel history={fullHistory} now={now} />,
          },
```

- [ ] **Step 7: Wire the preview page (`StockPreview`)**

In `StockPreview`, extend its `Promise.all`:

```tsx
  const [history, intraday, metrics, years, fullHistory] = await Promise.all([
    getPriceHistory(symbol),
    getIntradayHistory(symbol),
    covered ? getMetrics(symbol).catch(() => null) : Promise.resolve(null),
    covered ? getAnnualFinancials(symbol).catch(() => []) : Promise.resolve([]),
    getFullPriceHistory(symbol),
  ])
  const longHistory = downsample(fullHistory.points, new Date())
```

and pass it to its chart:

```tsx
          <PriceHistoryChart points={history} intraday={intraday.points} prevClose={intraday.prevClose} long={longHistory} />
```

`StockPreview` is rendered by `StockDetail` after `await connection()`; confirm that by reading where `<StockPreview` is used in the file. If it can be reached without `connection()` having run, add `await connection()` as the first line of `StockPreview`.

The preview has no tabs, so it only gains the long chart ranges.

- [ ] **Step 8: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: typecheck and lint clean; all tests pass (247 pre-existing plus 66 new = 313).

- [ ] **Step 9: Check it live**

Run: `npm run dev`, then open `http://localhost:3000/stock/NVDA#andamento` (use a symbol that is in the watchlist; add NVDA first if it is not).

Verify and write down the answer to each:

1. The `Andamento` tab is second, after `Valutazione`, and shows three cards.
2. The tiles include `20 anni` and `Tutto lo storico` for NVDA.
3. The yearly chart has one bar per year since 1999, with 1999 and the current year dimmed.
4. The drawdown sentence names a peak date and a worst drawdown.
5. **Is the note "Prima del … i dati sono meno fitti" shown?** If no, Yahoo returned full daily history for explicit dates (the primary path). If yes, the 10-year fallback was used. If instead the whole tab shows `Storico non disponibile al momento.` or the note names today's date, both requests failed or the 10-year request was itself sparse — stop and report this rather than working around it.
6. The top chart offers `5A`, `10A`, `Max`; each plots and the left axis date matches the range.
7. Open an Italian stock in the watchlist (for example `ENI.MI`): the tab works on prices alone.
8. Narrow the browser to 375px: no horizontal page scroll, tiles wrap, year labels do not overlap.
9. Open a symbol that is not in the watchlist: the preview chart shows the long ranges.

Stop the dev server afterwards.

- [ ] **Step 10: Commit**

```bash
git add components/PerformancePanel.tsx components/PerformancePanel.module.css tests/components/PerformancePanel.test.tsx "app/stock/[symbol]/page.tsx"
git commit -m "feat: add Andamento tab with performance, yearly returns and drawdown"
```

If `next dev` rewrote `AGENTS.md`, include it in this commit as that file instructs.

- [ ] **Step 11: Report**

Tell the user: which Yahoo path was taken (answer 5), the full-suite test count, and anything from Step 9 that did not match. Do not push.
