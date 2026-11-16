# Dividends Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Dividendi" tab to the stock page that says, in one sentence and two blocks, how regularly the stock pays, how much it yields, and whether the dividend grows or has been cut.

**Architecture:** A new module `lib/dividends.ts` downloads the dividend events from Yahoo (one small request per symbol, cached six hours) and turns them into yearly totals, frequency, trailing yield and growth figures with pure functions. A second module `lib/dividend-text.ts` holds the Italian amount formatting and the summary sentence. Three server components (`DividendYearsChart`, `DividendGrowth`, `DividendsPanel`) render the result; nothing runs in the browser.

**Tech Stack:** TypeScript, Next.js 16.4.6 App Router (`cacheComponents: true`), React 19, Vitest 5 + Testing Library (jsdom), CSS modules, hand-written SVG. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-dividends-design.md`

## Global Constraints

- **Next.js here is not the Next.js you know** (`AGENTS.md`): before editing anything under `app/`, list `node_modules/next/dist/docs/` and read the guide on server and client components; heed deprecation notices. If `next dev` rewrites `AGENTS.md`, commit it with the work.
- The calculation functions in `lib/dividends.ts` are pure: no `fetch`, no `Date.now()`, no `new Date()` without an argument. The reference date always arrives as a `now: Date` parameter. All calendar math is in **UTC** (`getUTCFullYear`).
- Only `getDividendHistory` touches the network: `https://query1.finance.yahoo.com/v8/finance/chart/<SYMBOL>?range=max&interval=1mo&events=div`, header `User-Agent: Mozilla/5.0` (as in `lib/history.ts`), 10 second timeout, cache 6 hours per symbol, last cached copy on any failure, never throws.
- `getDividendHistory` returns `null` for "data not available" and `{ payments: [], currency }` for "the stock pays nothing". The UI tells the two apart.
- Do not touch `lib/history.ts`, `lib/performance.ts` or `lib/seasonality.ts`. No new npm dependency, no Prisma migration, no new DB table.
- Percentages are plain numbers in percent units (`25` means 25%), named `...Pct`.
- UI copy is Italian. Exact strings: tab label `Dividendi`, tab id `dividendi`; `Dati sui dividendi non disponibili al momento.`; `Questo titolo non distribuisce dividendi.`; headings `Dividendi per anno` and `Crescita del dividendo`; tile labels `Anni consecutivi di aumento`, `Crescita annua media 5 anni`, `Crescita annua media 10 anni`.
- Amounts are formatted by `formatDividendAmount` (Task 3): `it-IT` currency, narrow symbol, 2 to 4 decimals. Node writes a no-break space (U+00A0) between amount and symbol, so `lib` tests compare strings with ` `. **Component tests must not:** Testing Library collapses U+00A0 to a plain space before matching, so component tests use regular expressions with `.` where the no-break space falls (for example `/0,50.\$/`), except when reading `textContent` of an `<title>` element directly, which keeps U+00A0.
- Growth uses `formatPct` from `lib/performance.ts` (one decimal, `it-IT` comma, `+` for gains, `−` U+2212 for losses). The yield is a plain number with one decimal and no sign.
- Colors come from existing tokens in `app/globals.css` only: `--brass`, `--gain-bright`, `--loss-bright`, `--surface`, `--surface-raised`, `--rule`, `--bone`, `--muted`, `--radius-card`, `--radius-inner`, `--card-shadow`.
- The page must never scroll horizontally at phone width.
- Tests cannot rely on CSS-module class names; components expose `data-*` attributes for the things tests check.
- Commit messages and code comments must not mention any AI tool or assistant, and must not carry `Co-Authored-By` or "Generated with" trailers.
- Work directly on `main`. Do not push.
- Run a single test file with `npx vitest run <path>`; typecheck with `npx tsc --noEmit`; lint with `npm run lint`. The full suite (`npm test`) needs the test Postgres from `.env.test`; it stood at 374 passing tests before this plan. `npm run lint` already reports 2 errors and 1 warning in `app/scopri/page.tsx` and `components/CompareSelection.tsx`; they predate this work — leave them.

Two refinements of the spec, written back into it in the same commit as this plan:

1. Growth fields carry the `Pct` suffix (`cagr5Pct`, `cagr10Pct`), as the rest of the code does.
2. Yahoo quotes London stocks in pence (`GBp`). Formatting that as pounds would be wrong by a factor of 100, so `GBp` amounts are shown as a plain number followed by ` p`.

## Review Focus

- **Dividend suspended (last payment older than 1.5 times the usual interval):** the sentence says it is suspended and shows no yield, even though a trailing-12-month total may exist. Pinned in Task 2 (the 136 and 137 day boundary and the fixed 400-day limit) and Task 3 (sentence with a yield present).
- **Years with no payment in the middle of the history:** a zero year after a paying year is a cut, a second zero year is not, the first paying year after the gap is an increase, and the zero year stays in the list. Pinned in Task 2.
- **Yahoo answers with no dividend events versus Yahoo failing:** "does not pay dividends" and "data not available" are different messages and must not be swapped. Pinned in Task 1 (empty payments versus `null`) and Task 6 (the two messages).
- **Only one payment, or a stock whose first dividend is this year:** no frequency, no growth block, the sentence still reads well, nothing is `NaN`. Pinned in Task 2 and Task 6.
- **Tiny amounts, missing currency, pence:** `0,0125 $` keeps its decimals, no currency gives a bare number, `GBp` is never shown as pounds. Pinned in Task 3.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/dividends.ts` (create) | Yahoo download and cache, payload parsing, and the pure calculations (`dividendSummary`). |
| `lib/dividend-text.ts` (create) | `formatDividendAmount` and `dividendSentence`: the Italian wording. |
| `components/DividendYearsChart.tsx` + `.module.css` (create) | Vertical bars of the yearly total per share. |
| `components/DividendGrowth.tsx` + `.module.css` (create) | Growth tiles and the list of cuts. |
| `components/DividendsPanel.tsx` + `.module.css` (create) | Composes the tab; owns the two empty states and the data note. |
| `app/stock/[symbol]/page.tsx` (modify) | Download the dividends with the other data; add the `Dividendi` tab after `Stagionalità`. |
| `tests/lib/dividends.test.ts`, `tests/lib/dividends-summary.test.ts`, `tests/lib/dividend-text.test.ts`, `tests/components/DividendYearsChart.test.tsx`, `tests/components/DividendGrowth.test.tsx`, `tests/components/DividendsPanel.test.tsx` (create) | Tests. |

---

### Task 1: Dividend download, parsing and cache

**Files:**
- Create: `lib/dividends.ts`
- Test: `tests/lib/dividends.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface DividendPayment { t: number; amount: number }` — `t` in milliseconds.
  - `interface DividendHistory { payments: DividendPayment[]; currency: string | null }` — payments oldest first.
  - `parseDividends(json: unknown): DividendHistory | null` — `null` when the payload is not a chart.
  - `getDividendHistory(symbol: string): Promise<DividendHistory | null>`

- [ ] **Step 1: Check the source with real requests**

Run (the app sends the same `User-Agent`; if the sandbox blocks the network, ask the user to run it with the `!` prefix):

```bash
fetchDiv() { curl -s -A "Mozilla/5.0" "https://query1.finance.yahoo.com/v8/finance/chart/$1?range=max&interval=1mo&events=div" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).chart.result[0];const dv=Object.values(r.events?.dividends??{});console.log(process.argv[1],"count="+dv.length,"currency="+r.meta.currency,JSON.stringify(dv.filter(d=>new Date(d.date*1000).getUTCFullYear()===2012)))})' "$1"; }
fetchDiv KO; fetchDiv AAPL; fetchDiv ENI.MI
```

Expected:
- `KO`: `count=` well above 150, `currency=USD`.
- `AAPL`: the 2012 entries show an `amount` near `0.09` (the 2012 payment of 2.65 divided by the 4-for-1 and 7-for-1 splits since), not `2.65`. This proves amounts are already split-adjusted.
- `ENI.MI`: `count=` above 0 and `currency=EUR`.

**If AAPL shows `2.65` (not adjusted), stop and ask the user:** the spec then requires adding `events=div,split` and adjusting the amounts, which this plan does not cover. If a request returns nothing for `events`, stop for the same reason. Otherwise continue, and record the three output lines in the ledger.

- [ ] **Step 2: Write the failing tests**

Create `tests/lib/dividends.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/dividends.test.ts`
Expected: FAIL — cannot resolve `@/lib/dividends`.

- [ ] **Step 4: Write the implementation**

Create `lib/dividends.ts`:

```ts
export interface DividendPayment {
  t: number
  amount: number
}

export interface DividendHistory {
  payments: DividendPayment[]
  currency: string | null
}

const TTL_MS = 6 * 60 * 60 * 1000
const cache = new Map<string, { at: number; data: DividendHistory }>()

// Dividend payments from a Yahoo chart payload, oldest first. Null when the payload is not a chart; a chart without `events.dividends` means the stock pays nothing.
export function parseDividends(json: unknown): DividendHistory | null {
  const result = (json as { chart?: { result?: Array<{ meta?: { currency?: unknown }; events?: { dividends?: unknown } }> | null } } | null)?.chart?.result?.[0]
  if (!result) return null
  const currency = typeof result.meta?.currency === 'string' && result.meta.currency.length > 0 ? result.meta.currency : null
  const raw = result.events?.dividends
  const rows = raw && typeof raw === 'object' ? Object.values(raw as Record<string, { amount?: unknown; date?: unknown }>) : []
  const byTime = new Map<number, number>()
  for (const entry of rows) {
    if (typeof entry?.date !== 'number' || !Number.isFinite(entry.date)) continue
    if (typeof entry.amount !== 'number' || !Number.isFinite(entry.amount) || entry.amount <= 0) continue
    byTime.set(entry.date * 1000, entry.amount)
  }
  const payments = [...byTime].map(([t, amount]) => ({ t, amount })).sort((a, b) => a.t - b.t)
  return { payments, currency }
}

// Whole dividend history of a listing. Returns the stale copy (or null) when Yahoo fails; never throws.
export async function getDividendHistory(symbol: string): Promise<DividendHistory | null> {
  const key = symbol.toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data

  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=max&interval=1mo&events=div`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return hit?.data ?? null
    const data = parseDividends(await res.json())
    if (!data) return hit?.data ?? null
    cache.set(key, { at: Date.now(), data })
    return data
  } catch {
    return hit?.data ?? null
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/dividends.test.ts`
Expected: PASS, 13 tests.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add lib/dividends.ts tests/lib/dividends.test.ts
git commit -m "feat: download and cache dividend history from Yahoo"
```

---

### Task 2: Yearly totals, frequency, yield and growth

**Files:**
- Modify: `lib/dividends.ts` (append)
- Test: `tests/lib/dividends-summary.test.ts` (create)

**Interfaces:**
- Consumes: `DividendPayment` from Task 1 (payments oldest first).
- Produces:
  - `type DividendFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'irregular'`
  - `interface DividendYear { year: number; total: number; count: number; partial: boolean }`
  - `interface DividendGrowthStats { completeYears: number; firstCompleteYear: number | null; consecutiveIncreases: number; cagr5Pct: number | null; cagr10Pct: number | null; cutYears: number[] }`
  - `interface DividendSummary { lastPayment: DividendPayment; years: DividendYear[]; ttmTotal: number; yieldPct: number | null; frequency: DividendFrequency | null; suspended: boolean; growth: DividendGrowthStats }`
  - `dividendSummary(payments: DividendPayment[], now: Date, price: number | null): DividendSummary | null`

Background for the implementer: a year is **complete** when it is after the year of the first payment and before the year of `now`; those two years are **partial**. `years` has one entry for every year from the first payment to the year of `now`, including years with no payment (`total` 0, `count` 0). Growth is computed on complete years only.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/dividends-summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dividendSummary, type DividendFrequency, type DividendPayment } from '@/lib/dividends'

const DAY_MS = 86_400_000
const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const pay = (iso: string, amount: number): DividendPayment => ({ t: at(iso), amount })
const NOW = new Date('2026-11-16T09:00:00Z')

// n payments spread evenly over the year, on the 10th of the month.
const spread = (year: number, n: number, amount = 1): DividendPayment[] =>
  Array.from({ length: n }, (_, i) => pay(`${year}-${String(Math.floor((i * 12) / n) + 1).padStart(2, '0')}-10`, amount))

// Quarterly payer raising every payment each year, 2021 to 2026: 0.40, 0.42 ... 0.50.
const RAISING = [2021, 2022, 2023, 2024, 2025, 2026].flatMap((year, i) => spread(year, 4, 0.4 + i * 0.02))

// Annual payer on 1 June: 0.5 in 2014, then 1, 2, 4 ... doubling every year up to 2026.
const DOUBLING = [pay('2014-06-01', 0.5), ...Array.from({ length: 12 }, (_, i) => pay(`${2015 + i}-06-01`, 2 ** i))]

describe('dividendSummary', () => {
  it('lists every year from the first payment, flagging the first and the current as partial', () => {
    const years = dividendSummary(RAISING, NOW, 100)!.years
    expect(years.map((y) => [y.year, y.count, y.partial])).toEqual([
      [2021, 4, true],
      [2022, 4, false],
      [2023, 4, false],
      [2024, 4, false],
      [2025, 4, false],
      [2026, 4, true],
    ])
    expect(years.map((y) => y.total)).toEqual([1.6, 1.68, 1.76, 1.84, 1.92, 2])
  })

  it('reports the last payment, the trailing twelve months and the yield on the price', () => {
    const summary = dividendSummary(RAISING, NOW, 100)!
    expect(summary.lastPayment.t).toBe(at('2026-10-10'))
    expect(summary.lastPayment.amount).toBeCloseTo(0.5)
    expect(summary.ttmTotal).toBeCloseTo(2)
    expect(summary.yieldPct).toBeCloseTo(2)
  })

  it('leaves the yield empty without a usable price', () => {
    expect(dividendSummary(RAISING, NOW, null)!.yieldPct).toBeNull()
    expect(dividendSummary(RAISING, NOW, 0)!.yieldPct).toBeNull()
    expect(dividendSummary(RAISING, NOW, -5)!.yieldPct).toBeNull()
  })

  it('ignores payments dated after now', () => {
    const summary = dividendSummary([...RAISING, pay('2026-12-10', 0.9)], NOW, 100)!
    expect(summary.lastPayment.t).toBe(at('2026-10-10'))
    expect(summary.years[summary.years.length - 1].total).toBe(2)
  })

  it('returns null when no payment is dated on or before now', () => {
    expect(dividendSummary([], NOW, 100)).toBeNull()
    expect(dividendSummary([pay('2026-12-10', 1)], NOW, 100)).toBeNull()
  })

  it.each<[number, DividendFrequency]>([
    [12, 'monthly'],
    [4, 'quarterly'],
    [2, 'semiannual'],
    [1, 'annual'],
    [6, 'irregular'],
  ])('classifies %i payments a year as %s', (n, expected) => {
    const history = [2021, 2022, 2023, 2024, 2025].flatMap((year) => spread(year, n))
    expect(dividendSummary(history, NOW, 100)!.frequency).toBe(expected)
  })

  it('handles a single payment: no frequency, one partial year, no growth', () => {
    const summary = dividendSummary([pay('2026-05-04', 0.25)], NOW, 50)!
    expect(summary.frequency).toBeNull()
    expect(summary.suspended).toBe(false)
    expect(summary.years).toEqual([{ year: 2026, total: 0.25, count: 1, partial: true }])
    expect(summary.yieldPct).toBeCloseTo(0.5)
    expect(summary.growth).toEqual({ completeYears: 0, firstCompleteYear: null, consecutiveIncreases: 0, cagr5Pct: null, cagr10Pct: null, cutYears: [] })
  })

  it('applies a fixed 400-day limit when there is no regular rhythm', () => {
    expect(dividendSummary([pay('2025-10-10', 1)], NOW, 100)!.suspended).toBe(true)
    expect(dividendSummary([pay('2025-11-01', 1)], NOW, 100)!.suspended).toBe(false)
  })

  it('calls a quarterly payer suspended once 1.5 intervals have passed', () => {
    const history = [2021, 2022, 2023, 2024, 2025].flatMap((year) => spread(year, 4))
    const last = at('2025-10-10')
    expect(dividendSummary(history, new Date(last + 136 * DAY_MS), 100)!.suspended).toBe(false)
    expect(dividendSummary(history, new Date(last + 137 * DAY_MS), 100)!.suspended).toBe(true)
  })

  it('counts consecutive yearly increases on complete years, with no CAGR when the history is short', () => {
    expect(dividendSummary(RAISING, NOW, 100)!.growth).toEqual({
      completeYears: 4,
      firstCompleteYear: 2022,
      consecutiveIncreases: 3,
      cagr5Pct: null,
      cagr10Pct: null,
      cutYears: [],
    })
  })

  it('computes the compound yearly growth over 5 and 10 years', () => {
    const summary = dividendSummary(DOUBLING, NOW, 100)!
    expect(summary.frequency).toBe('annual')
    expect(summary.suspended).toBe(false)
    expect(summary.growth.completeYears).toBe(11)
    expect(summary.growth.firstCompleteYear).toBe(2015)
    expect(summary.growth.consecutiveIncreases).toBe(10)
    expect(summary.growth.cagr5Pct).toBeCloseTo(100, 6)
    expect(summary.growth.cagr10Pct).toBeCloseTo(100, 6)
    expect(summary.growth.cutYears).toEqual([])
  })

  it('gives no CAGR when the base year paid nothing, and counts the empty year as a cut', () => {
    const summary = dividendSummary(
      DOUBLING.filter((p) => new Date(p.t).getUTCFullYear() !== 2020),
      NOW,
      100,
    )!
    expect(summary.growth.cagr5Pct).toBeNull()
    expect(summary.growth.cagr10Pct).toBeCloseTo(100, 6)
    expect(summary.growth.cutYears).toEqual([2020])
    expect(summary.growth.consecutiveIncreases).toBe(5)
  })

  it('counts a cut only below 95% of the year before, and keeps empty years in the list', () => {
    const history = [pay('2014-06-01', 1), pay('2015-06-01', 1), pay('2016-06-01', 0.96), pay('2017-06-01', 0.5), pay('2018-06-01', 0.75), pay('2020-06-01', 0.8)]
    const summary = dividendSummary(history, new Date('2021-11-16T09:00:00Z'), 100)!
    expect(summary.growth.cutYears).toEqual([2017, 2019])
    expect(summary.growth.consecutiveIncreases).toBe(1)
    expect(summary.growth.completeYears).toBe(6)
    expect(summary.growth.firstCompleteYear).toBe(2015)
    expect(summary.growth.cagr5Pct).toBeCloseTo(-4.37, 1)
    expect(summary.growth.cagr10Pct).toBeNull()
    expect(summary.years.find((y) => y.year === 2019)).toEqual({ year: 2019, total: 0, count: 0, partial: false })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/dividends-summary.test.ts`
Expected: FAIL — `dividendSummary` is not exported (reported as "is not a function").

- [ ] **Step 3: Write the implementation**

Append to `lib/dividends.ts`:

```ts

const DAY_MS = 86_400_000
// A year counts as a cut when it pays less than this share of the year before; it keeps small rounding or exchange-rate wobble out.
const CUT_RATIO = 0.95
// Without a regular rhythm there is no interval to scale, so a payment older than this means the dividend stopped.
const IRREGULAR_STALE_DAYS = 400
const PAYMENTS_PER_YEAR = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 } as const

export type DividendFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'irregular'

export interface DividendYear {
  year: number
  total: number
  count: number
  partial: boolean
}

export interface DividendGrowthStats {
  completeYears: number
  firstCompleteYear: number | null
  consecutiveIncreases: number
  cagr5Pct: number | null
  cagr10Pct: number | null
  cutYears: number[]
}

export interface DividendSummary {
  lastPayment: DividendPayment
  years: DividendYear[]
  ttmTotal: number
  yieldPct: number | null
  frequency: DividendFrequency | null
  suspended: boolean
  growth: DividendGrowthStats
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function frequencyOf(perYear: number): DividendFrequency {
  if (perYear >= 10) return 'monthly'
  if (perYear >= 3 && perYear <= 5) return 'quarterly'
  if (perYear === 2) return 'semiannual'
  if (perYear === 1) return 'annual'
  return 'irregular'
}

// Compound yearly growth between the last complete year and the one `span` years earlier.
function cagrPct(complete: DividendYear[], span: number): number | null {
  if (complete.length < span + 1) return null
  const last = complete[complete.length - 1].total
  const base = complete[complete.length - 1 - span].total
  if (last <= 0 || base <= 0) return null
  return ((last / base) ** (1 / span) - 1) * 100
}

function growthOf(complete: DividendYear[]): DividendGrowthStats {
  let consecutiveIncreases = 0
  for (let i = complete.length - 1; i >= 1; i--) {
    if (complete[i].total > complete[i - 1].total) consecutiveIncreases++
    else break
  }
  const cutYears: number[] = []
  for (let i = 1; i < complete.length; i++) {
    if (complete[i].total < complete[i - 1].total * CUT_RATIO) cutYears.push(complete[i].year)
  }
  return {
    completeYears: complete.length,
    firstCompleteYear: complete[0]?.year ?? null,
    consecutiveIncreases,
    cagr5Pct: cagrPct(complete, 5),
    cagr10Pct: cagrPct(complete, 10),
    cutYears,
  }
}

// Yearly totals, rhythm, trailing yield and growth of a dividend history (oldest payment first). Payments dated after `now` are ignored; null when none remain.
export function dividendSummary(payments: DividendPayment[], now: Date, price: number | null): DividendSummary | null {
  const paid = payments.filter((p) => p.t <= now.getTime())
  if (paid.length === 0) return null

  const firstYear = new Date(paid[0].t).getUTCFullYear()
  const currentYear = now.getUTCFullYear()
  const years: DividendYear[] = []
  for (let year = firstYear; year <= currentYear; year++) {
    const own = paid.filter((p) => new Date(p.t).getUTCFullYear() === year)
    years.push({ year, total: round6(own.reduce((sum, p) => sum + p.amount, 0)), count: own.length, partial: year === firstYear || year === currentYear })
  }
  const complete = years.filter((y) => !y.partial)

  const lastPayment = paid[paid.length - 1]
  const ttmTotal = round6(paid.filter((p) => p.t > now.getTime() - 365 * DAY_MS).reduce((sum, p) => sum + p.amount, 0))
  const yieldPct = price !== null && price > 0 ? (ttmTotal / price) * 100 : null

  const recent = complete.slice(-3)
  const frequency = recent.length > 0 ? frequencyOf(median(recent.map((y) => y.count))) : null
  const staleAfterDays = frequency && frequency !== 'irregular' ? 1.5 * (365 / PAYMENTS_PER_YEAR[frequency]) : IRREGULAR_STALE_DAYS
  const suspended = (now.getTime() - lastPayment.t) / DAY_MS > staleAfterDays

  return { lastPayment, years, ttmTotal, yieldPct, frequency, suspended, growth: growthOf(complete) }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/dividends-summary.test.ts tests/lib/dividends.test.ts`
Expected: PASS, 30 tests (17 new, 13 from Task 1; `it.each` counts as 5).

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/dividends.ts tests/lib/dividends-summary.test.ts
git commit -m "feat: add dividend yearly totals, frequency, yield and growth"
```

---

### Task 3: Amount formatting and the summary sentence

**Files:**
- Create: `lib/dividend-text.ts`
- Test: `tests/lib/dividend-text.test.ts` (create)

**Interfaces:**
- Consumes: `DividendFrequency`, `DividendSummary` from Task 2.
- Produces:
  - `formatDividendAmount(amount: number, currency: string | null): string`
  - `dividendSentence(summary: DividendSummary, currency: string | null): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/dividend-text.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DividendFrequency, DividendSummary } from '@/lib/dividends'
import { dividendSentence, formatDividendAmount } from '@/lib/dividend-text'

const NBSP = ' '
const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)

const summary = (overrides: Partial<DividendSummary> = {}): DividendSummary => ({
  lastPayment: { t: at('2026-10-10'), amount: 0.5 },
  years: [],
  ttmTotal: 2,
  yieldPct: 2,
  frequency: 'quarterly',
  suspended: false,
  growth: { completeYears: 0, firstCompleteYear: null, consecutiveIncreases: 0, cagr5Pct: null, cagr10Pct: null, cutYears: [] },
  ...overrides,
})

describe('formatDividendAmount', () => {
  it('writes the amount in the currency symbol with at least two decimals', () => {
    expect(formatDividendAmount(0.51, 'USD')).toBe(`0,51${NBSP}$`)
    expect(formatDividendAmount(1.68, 'EUR')).toBe(`1,68${NBSP}€`)
    expect(formatDividendAmount(0.5, 'USD')).toBe(`0,50${NBSP}$`)
  })

  it('keeps up to four decimals for tiny amounts', () => {
    expect(formatDividendAmount(0.0125, 'USD')).toBe(`0,0125${NBSP}$`)
  })

  it('writes a bare number when the currency is missing', () => {
    expect(formatDividendAmount(0.5, null)).toBe('0,50')
  })

  it('writes a bare number when the currency code is not one Intl knows', () => {
    expect(formatDividendAmount(0.5, 'XX')).toBe('0,50')
  })

  it('never shows pence as pounds', () => {
    expect(formatDividendAmount(12.5, 'GBp')).toBe(`12,50${NBSP}p`)
  })
})

describe('dividendSentence', () => {
  it('names the rhythm, the last payment and the trailing yield', () => {
    expect(dividendSentence(summary(), 'USD')).toBe(`Paga ogni trimestre. Ultimo dividendo 0,50${NBSP}$ il 10 ottobre 2026, rendimento 2,0% sugli ultimi 12 mesi.`)
  })

  it.each<[DividendFrequency, string]>([
    ['monthly', 'Paga ogni mese. '],
    ['semiannual', "Paga due volte l'anno. "],
    ['annual', "Paga una volta l'anno. "],
    ['irregular', 'Paga senza cadenza regolare. '],
  ])('describes a %s payer', (frequency, opening) => {
    expect(dividendSentence(summary({ frequency }), 'USD').startsWith(opening)).toBe(true)
  })

  it('leaves the rhythm out when it is not known', () => {
    expect(dividendSentence(summary({ frequency: null }), 'USD')).toBe(`Ultimo dividendo 0,50${NBSP}$ il 10 ottobre 2026, rendimento 2,0% sugli ultimi 12 mesi.`)
  })

  it('leaves the yield out when there is none or it is zero', () => {
    const expected = `Paga ogni trimestre. Ultimo dividendo 0,50${NBSP}$ il 10 ottobre 2026.`
    expect(dividendSentence(summary({ yieldPct: null }), 'USD')).toBe(expected)
    expect(dividendSentence(summary({ yieldPct: 0 }), 'USD')).toBe(expected)
  })

  it('says the dividend is suspended and shows no yield, even when a trailing total exists', () => {
    expect(dividendSentence(summary({ suspended: true, yieldPct: 1.2 }), 'USD')).toBe(`Dividendo sospeso: l'ultimo pagamento è stato di 0,50${NBSP}$ il 10 ottobre 2026.`)
  })

  it('writes plain numbers when the currency is missing', () => {
    expect(dividendSentence(summary(), null)).toBe('Paga ogni trimestre. Ultimo dividendo 0,50 il 10 ottobre 2026, rendimento 2,0% sugli ultimi 12 mesi.')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/dividend-text.test.ts`
Expected: FAIL — cannot resolve `@/lib/dividend-text`.

- [ ] **Step 3: Write the implementation**

Create `lib/dividend-text.ts`:

```ts
import type { DividendFrequency, DividendSummary } from '@/lib/dividends'

const NBSP = ' '
const FREQUENCY_PHRASE: Record<DividendFrequency, string> = {
  monthly: 'ogni mese',
  quarterly: 'ogni trimestre',
  semiannual: "due volte l'anno",
  annual: "una volta l'anno",
  irregular: 'senza cadenza regolare',
}

export function formatDividendAmount(amount: number, currency: string | null): string {
  const digits = { minimumFractionDigits: 2, maximumFractionDigits: 4 }
  const plain = amount.toLocaleString('it-IT', digits)
  // Yahoo quotes London stocks in pence (GBp); formatting that as pounds would be wrong by a factor of 100.
  if (currency === 'GBp') return `${plain}${NBSP}p`
  if (currency) {
    try {
      return amount.toLocaleString('it-IT', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', ...digits })
    } catch {
      // A code Intl does not know: fall through to the bare number.
    }
  }
  return plain
}

const longDate = (t: number) => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export function dividendSentence(summary: DividendSummary, currency: string | null): string {
  const amount = formatDividendAmount(summary.lastPayment.amount, currency)
  const date = longDate(summary.lastPayment.t)
  if (summary.suspended) return `Dividendo sospeso: l'ultimo pagamento è stato di ${amount} il ${date}.`
  const rhythm = summary.frequency ? `Paga ${FREQUENCY_PHRASE[summary.frequency]}. ` : ''
  const yieldPart =
    summary.yieldPct !== null && summary.yieldPct > 0
      ? `, rendimento ${summary.yieldPct.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% sugli ultimi 12 mesi`
      : ''
  return `${rhythm}Ultimo dividendo ${amount} il ${date}${yieldPart}.`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/dividend-text.test.ts`
Expected: PASS, 14 tests (5 formatting, 9 sentence; `it.each` counts as 4).

- [ ] **Step 5: Commit**

```bash
git add lib/dividend-text.ts tests/lib/dividend-text.test.ts
git commit -m "feat: add dividend amount formatting and summary sentence"
```

---

### Task 4: `DividendYearsChart`

**Files:**
- Create: `components/DividendYearsChart.tsx`, `components/DividendYearsChart.module.css`
- Test: `tests/components/DividendYearsChart.test.tsx` (create)

**Interfaces:**
- Consumes: `DividendYear` from Task 2; `formatDividendAmount` from Task 3.
- Produces: `DividendYearsChart({ years, currency }: { years: DividendYear[]; currency: string | null })` — shows the last 15 entries. One `<rect data-tone="paid" data-partial="true|false">` per year with a positive total (a year with no payment has no bar). Renders nothing for an empty list.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/DividendYearsChart.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DividendYearsChart } from '@/components/DividendYearsChart'

const NBSP = ' '
const YEARS = [
  { year: 2022, total: 1.68, count: 4, partial: false },
  { year: 2023, total: 0, count: 0, partial: false },
  { year: 2024, total: 1.84, count: 4, partial: false },
  { year: 2025, total: 0.5, count: 1, partial: true },
]

describe('DividendYearsChart', () => {
  it('draws a bar for every year that paid, none for an empty year, with partial years marked', () => {
    const { container } = render(<DividendYearsChart years={YEARS} currency="USD" />)
    const bars = container.querySelectorAll('rect[data-tone]')
    expect(bars).toHaveLength(3)
    expect(Array.from(bars).map((b) => b.getAttribute('data-partial'))).toEqual(['false', 'false', 'true'])
    const titles = Array.from(container.querySelectorAll('title')).map((t) => t.textContent)
    expect(titles).toEqual([`2022: 1,68${NBSP}$ in 4 pagamenti`, `2024: 1,84${NBSP}$ in 4 pagamenti`, `2025: 0,50${NBSP}$ in 1 pagamento (parziale)`])
  })

  it('scales bar heights to the largest yearly total', () => {
    const { container } = render(<DividendYearsChart years={YEARS} currency="USD" />)
    const heights = Array.from(container.querySelectorAll('rect[data-tone]')).map((b) => Number(b.getAttribute('height')))
    expect(heights[1]).toBeCloseTo(166)
    expect(heights[0]).toBeCloseTo(151.57, 1)
    expect(heights[2]).toBeCloseTo(45.11, 1)
  })

  it('summarises the chart in its accessible name and in visible text', () => {
    render(<DividendYearsChart years={YEARS} currency="USD" />)
    expect(screen.getByRole('img', { name: /dal 2022 al 2025: 3 anni con pagamenti su 4\. Massimo 1,84.\$ nel 2024/ })).toBeInTheDocument()
    expect(screen.getByText(/Massimo: 1,84.\$ \(2024\)/)).toBeInTheDocument()
    expect(screen.getByText(/anno parziale/i)).toBeInTheDocument()
  })

  it('shows only the last fifteen years', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ year: 2006 + i, total: 1 + i, count: 4, partial: false }))
    const { container } = render(<DividendYearsChart years={many} currency="EUR" />)
    expect(container.querySelectorAll('rect[data-tone]')).toHaveLength(15)
    expect(screen.getByRole('img', { name: /dal 2011 al 2025/ })).toBeInTheDocument()
  })

  it('renders without NaN when no year paid anything', () => {
    const { container } = render(
      <DividendYearsChart
        years={[
          { year: 2024, total: 0, count: 0, partial: false },
          { year: 2025, total: 0, count: 0, partial: true },
        ]}
        currency="USD"
      />,
    )
    expect(container.querySelectorAll('rect[data-tone]')).toHaveLength(0)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('renders nothing without years', () => {
    const { container } = render(<DividendYearsChart years={[]} currency="USD" />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/DividendYearsChart.test.tsx`
Expected: FAIL — cannot resolve `@/components/DividendYearsChart`.

- [ ] **Step 3: Write the implementation**

Create `components/DividendYearsChart.tsx`:

```tsx
import { formatDividendAmount } from '@/lib/dividend-text'
import type { DividendYear } from '@/lib/dividends'
import styles from './DividendYearsChart.module.css'

const W = 640
const H = 200
const PAD = { top: 12, right: 8, bottom: 22, left: 8 }
const MAX_LABELS = 10
const MAX_YEARS = 15

export function DividendYearsChart({ years, currency }: { years: DividendYear[]; currency: string | null }) {
  const shown = years.slice(-MAX_YEARS)
  if (shown.length === 0) return null

  const peak = shown.reduce((a, b) => (b.total > a.total ? b : a))
  const max = peak.total
  const plotH = H - PAD.top - PAD.bottom
  const slot = (W - PAD.left - PAD.right) / shown.length
  const barW = Math.min(36, slot * 0.7)
  const labelStep = Math.ceil(shown.length / MAX_LABELS)
  const paid = shown.filter((v) => v.total > 0).length
  const label = `Dividendi per azione anno per anno dal ${shown[0].year} al ${shown[shown.length - 1].year}: ${paid} anni con pagamenti su ${shown.length}.${max > 0 ? ` Massimo ${formatDividendAmount(max, currency)} nel ${peak.year}.` : ''}`

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={label}>
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className={styles.base} />
        {shown.map((v, i) => {
          if (v.total <= 0) return null
          const height = Math.max(1, (v.total / max) * plotH)
          return (
            <rect key={v.year} x={PAD.left + i * slot + (slot - barW) / 2} y={H - PAD.bottom - height} width={barW} height={height} rx={2} className={styles.bar} data-tone="paid" data-partial={v.partial ? 'true' : 'false'}>
              <title>{`${v.year}: ${formatDividendAmount(v.total, currency)} in ${v.count} ${v.count === 1 ? 'pagamento' : 'pagamenti'}${v.partial ? ' (parziale)' : ''}`}</title>
            </rect>
          )
        })}
        {shown.map((v, i) =>
          (shown.length - 1 - i) % labelStep === 0 ? (
            <text key={v.year} x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" className={styles.axis}>
              {v.year}
            </text>
          ) : null,
        )}
      </svg>
      <p className={styles.note}>
        {max > 0 && `Massimo: ${formatDividendAmount(max, currency)} (${peak.year})`}
        {shown.some((v) => v.partial) && `${max > 0 ? ' · ' : ''}Barre attenuate: anno parziale`}
      </p>
    </div>
  )
}
```

Create `components/DividendYearsChart.module.css`:

```css
.svg {
  display: block;
  width: 100%;
  height: auto;
}

.base {
  stroke: var(--rule);
  stroke-width: 1;
}

.bar {
  fill: var(--brass);
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/DividendYearsChart.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add components/DividendYearsChart.tsx components/DividendYearsChart.module.css tests/components/DividendYearsChart.test.tsx
git commit -m "feat: add yearly dividend bar chart"
```

---

### Task 5: `DividendGrowth`

**Files:**
- Create: `components/DividendGrowth.tsx`, `components/DividendGrowth.module.css`
- Test: `tests/components/DividendGrowth.test.tsx` (create)

**Interfaces:**
- Consumes: `DividendGrowthStats` from Task 2; `formatPct` from `lib/performance.ts`.
- Produces: `DividendGrowth({ growth }: { growth: DividendGrowthStats })` — a `<dl>` of tiles (each `<dd data-tone="gain|loss|flat">`) followed by a paragraph with the cuts. Renders nothing when `growth.completeYears < 2`.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/DividendGrowth.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DividendGrowth } from '@/components/DividendGrowth'
import type { DividendGrowthStats } from '@/lib/dividends'

const GROWTH: DividendGrowthStats = { completeYears: 11, firstCompleteYear: 2015, consecutiveIncreases: 10, cagr5Pct: 12.34, cagr10Pct: 8, cutYears: [] }
const tile = (label: string) => screen.getByText(label).closest('div') as HTMLElement

describe('DividendGrowth', () => {
  it('shows the consecutive increases and both growth rates, and says there was no cut', () => {
    render(<DividendGrowth growth={GROWTH} />)
    expect(tile('Anni consecutivi di aumento')).toHaveTextContent('10')
    expect(tile('Crescita annua media 5 anni')).toHaveTextContent('+12,3%')
    expect(tile('Crescita annua media 10 anni')).toHaveTextContent('+8,0%')
    expect(screen.getByText('Nessun taglio dal 2015')).toBeInTheDocument()
  })

  it('lists the years with a cut', () => {
    render(<DividendGrowth growth={{ ...GROWTH, cutYears: [2017, 2019] }} />)
    expect(screen.getByText('Tagli: 2017, 2019')).toBeInTheDocument()
    expect(screen.queryByText(/Nessun taglio/)).not.toBeInTheDocument()
  })

  it('leaves out the growth rates that cannot be computed', () => {
    render(<DividendGrowth growth={{ ...GROWTH, cagr5Pct: null, cagr10Pct: null }} />)
    expect(screen.getByText('Anni consecutivi di aumento')).toBeInTheDocument()
    expect(screen.queryByText('Crescita annua media 5 anni')).not.toBeInTheDocument()
    expect(screen.queryByText('Crescita annua media 10 anni')).not.toBeInTheDocument()
  })

  it('tones a negative growth rate as a loss and zero increases as flat', () => {
    const { container } = render(<DividendGrowth growth={{ ...GROWTH, consecutiveIncreases: 0, cagr5Pct: -3.2, cagr10Pct: null }} />)
    expect(Array.from(container.querySelectorAll('dd')).map((d) => [d.textContent, d.getAttribute('data-tone')])).toEqual([
      ['0', 'flat'],
      ['−3,2%', 'loss'],
    ])
  })

  it('renders nothing with fewer than two complete years', () => {
    const { container } = render(<DividendGrowth growth={{ ...GROWTH, completeYears: 1 }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/DividendGrowth.test.tsx`
Expected: FAIL — cannot resolve `@/components/DividendGrowth`.

- [ ] **Step 3: Write the implementation**

Create `components/DividendGrowth.tsx`:

```tsx
import { formatPct } from '@/lib/performance'
import type { DividendGrowthStats } from '@/lib/dividends'
import styles from './DividendGrowth.module.css'

type Tone = 'gain' | 'loss' | 'flat'

export function DividendGrowth({ growth }: { growth: DividendGrowthStats }) {
  if (growth.completeYears < 2) return null

  const tiles: Array<{ label: string; value: string; tone: Tone }> = [
    { label: 'Anni consecutivi di aumento', value: String(growth.consecutiveIncreases), tone: growth.consecutiveIncreases > 0 ? 'gain' : 'flat' },
  ]
  if (growth.cagr5Pct !== null) tiles.push({ label: 'Crescita annua media 5 anni', value: formatPct(growth.cagr5Pct), tone: growth.cagr5Pct >= 0 ? 'gain' : 'loss' })
  if (growth.cagr10Pct !== null) tiles.push({ label: 'Crescita annua media 10 anni', value: formatPct(growth.cagr10Pct), tone: growth.cagr10Pct >= 0 ? 'gain' : 'loss' })

  return (
    <>
      <dl className={styles.grid}>
        {tiles.map((t) => (
          <div key={t.label} className={styles.tile}>
            <dt className={styles.label}>{t.label}</dt>
            <dd className={styles.value} data-tone={t.tone}>
              {t.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.cuts}>{growth.cutYears.length > 0 ? `Tagli: ${growth.cutYears.join(', ')}` : `Nessun taglio dal ${growth.firstCompleteYear}`}</p>
    </>
  )
}
```

Create `components/DividendGrowth.module.css`:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
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

.cuts {
  margin-top: 10px;
  font-size: 13px;
  color: var(--muted);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/DividendGrowth.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add components/DividendGrowth.tsx components/DividendGrowth.module.css tests/components/DividendGrowth.test.tsx
git commit -m "feat: add dividend growth tiles and cuts"
```

---

### Task 6: `DividendsPanel` and the `Dividendi` tab

**Files:**
- Create: `components/DividendsPanel.tsx`, `components/DividendsPanel.module.css`
- Modify: `app/stock/[symbol]/page.tsx` (two imports; the second `Promise.all`; one entry in the `tabs` array)
- Test: `tests/components/DividendsPanel.test.tsx` (create)

**Interfaces:**
- Consumes: `DividendHistory`, `dividendSummary` (Tasks 1, 2); `dividendSentence` (Task 3); `DividendYearsChart` (Task 4); `DividendGrowth` (Task 5). In `app/stock/[symbol]/page.tsx` the watchlist branch has `stock`, `latest` (the newest `PriceSnapshot`, possibly undefined) and `now` (a `Date`) in scope.
- Produces: `DividendsPanel({ history, price, now }: { history: DividendHistory | null; price: number | null; now: Date })` — server component.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/DividendsPanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DividendsPanel } from '@/components/DividendsPanel'
import type { DividendPayment } from '@/lib/dividends'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const pay = (iso: string, amount: number): DividendPayment => ({ t: at(iso), amount })
const NOW = new Date('2026-11-16T09:00:00Z')

// Quarterly payer raising the payment every year, 2021 to 2026: 0.40 ... 0.50 on 10 January, April, July and October.
const RAISING = [2021, 2022, 2023, 2024, 2025, 2026].flatMap((year, i) =>
  ['01', '04', '07', '10'].map((month) => pay(`${year}-${month}-10`, 0.4 + i * 0.02)),
)

describe('DividendsPanel', () => {
  it('renders the sentence, the yearly chart, the growth block and the data note', () => {
    render(<DividendsPanel history={{ payments: RAISING, currency: 'USD' }} price={100} now={NOW} />)
    expect(screen.getByText(/Paga ogni trimestre\. Ultimo dividendo 0,50.\$ il 10 ottobre 2026, rendimento 2,0% sugli ultimi 12 mesi\./)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Dividendi per anno' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Dividendi per azione anno per anno dal 2021 al 2026/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Crescita del dividendo' })).toBeInTheDocument()
    expect(screen.getByText('Anni consecutivi di aumento')).toBeInTheDocument()
    expect(screen.getByText(/dividendi straordinari inclusi/)).toBeInTheDocument()
    expect(screen.getByText(/I dividendi passati non garantiscono quelli futuri/)).toBeInTheDocument()
  })

  it('says the data is unavailable when Yahoo gave nothing', () => {
    render(<DividendsPanel history={null} price={100} now={NOW} />)
    expect(screen.getByText('Dati sui dividendi non disponibili al momento.')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('says the stock pays no dividends when Yahoo lists none', () => {
    render(<DividendsPanel history={{ payments: [], currency: 'USD' }} price={100} now={NOW} />)
    expect(screen.getByText('Questo titolo non distribuisce dividendi.')).toBeInTheDocument()
    expect(screen.queryByText(/non disponibili/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('handles a stock with a single payment: no rhythm, no growth block', () => {
    const { container } = render(<DividendsPanel history={{ payments: [pay('2026-05-04', 0.25)], currency: 'USD' }} price={50} now={NOW} />)
    expect(screen.getByText(/^Ultimo dividendo 0,25.\$ il 4 maggio 2026, rendimento 0,5% sugli ultimi 12 mesi\.$/)).toBeInTheDocument()
    expect(screen.queryByText(/^Paga/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Dividendi per anno' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Crescita del dividendo' })).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('leaves the yield out without a price', () => {
    render(<DividendsPanel history={{ payments: RAISING, currency: 'USD' }} price={null} now={NOW} />)
    expect(screen.getByText(/Ultimo dividendo 0,50.\$ il 10 ottobre 2026\./)).toBeInTheDocument()
    expect(screen.queryByText(/rendimento/)).not.toBeInTheDocument()
  })

  it('writes plain numbers when the currency is missing', () => {
    render(<DividendsPanel history={{ payments: RAISING, currency: null }} price={100} now={NOW} />)
    expect(screen.getByText(/Ultimo dividendo 0,50 il 10 ottobre 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/DividendsPanel.test.tsx`
Expected: FAIL — cannot resolve `@/components/DividendsPanel`.

- [ ] **Step 3: Write the panel**

Create `components/DividendsPanel.tsx`:

```tsx
import { dividendSentence } from '@/lib/dividend-text'
import { dividendSummary, type DividendHistory } from '@/lib/dividends'
import { DividendGrowth } from '@/components/DividendGrowth'
import { DividendYearsChart } from '@/components/DividendYearsChart'
import styles from './DividendsPanel.module.css'

export function DividendsPanel({ history, price, now }: { history: DividendHistory | null; price: number | null; now: Date }) {
  if (history === null) return <p className={styles.empty}>Dati sui dividendi non disponibili al momento.</p>

  const summary = dividendSummary(history.payments, now, price)
  if (!summary) return <p className={styles.empty}>Questo titolo non distribuisce dividendi.</p>

  return (
    <div className={styles.panel}>
      <section className={styles.card} aria-label="Riepilogo dei dividendi">
        <p className={styles.sentence}>{dividendSentence(summary, history.currency)}</p>
      </section>

      <section className={styles.card} aria-labelledby="dividends-years-title">
        <h2 id="dividends-years-title" className={styles.title}>
          Dividendi per anno
        </h2>
        <DividendYearsChart years={summary.years} currency={history.currency} />
      </section>

      {summary.growth.completeYears >= 2 && (
        <section className={styles.card} aria-labelledby="dividends-growth-title">
          <h2 id="dividends-growth-title" className={styles.title}>
            Crescita del dividendo
          </h2>
          <DividendGrowth growth={summary.growth} />
        </section>
      )}

      <p className={styles.note}>Importi per azione nella valuta del titolo, dividendi straordinari inclusi. Fonte: Yahoo Finance. I dividendi passati non garantiscono quelli futuri.</p>
    </div>
  )
}
```

Create `components/DividendsPanel.module.css`:

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

.sentence {
  font-size: 16px;
  line-height: 1.5;
  max-width: 75ch;
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

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `npx vitest run tests/components/DividendsPanel.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the tab into the stock page**

List `node_modules/next/dist/docs/` and read the guide on server and client components (the panel is a server component that receives plain serialisable props, the same pattern as `SeasonalityPanel`).

In `app/stock/[symbol]/page.tsx`, next to the existing `SeasonalityPanel` import, add:

```tsx
import { DividendsPanel } from '@/components/DividendsPanel'
```

and next to the `@/lib/history` import:

```tsx
import { getDividendHistory } from '@/lib/dividends'
```

In the **second** `Promise.all` of the file (the watchlist branch, the one that has `getRecentVideos(stock.symbol, stock.name)`), replace

```tsx
  const [history, intraday, videos, insiders, congress, financials, metrics, fullHistory] = await Promise.all([
```

with

```tsx
  const [history, intraday, videos, insiders, congress, financials, metrics, fullHistory, dividends] = await Promise.all([
```

and replace its last two lines

```tsx
    getFullPriceHistory(stock.symbol),
  ])
  const now = new Date()
```

with

```tsx
    getFullPriceHistory(stock.symbol),
    getDividendHistory(stock.symbol),
  ])
  const now = new Date()
```

In the `tabs` array of `<StockTabs>`, directly after this existing entry:

```tsx
          {
            id: 'stagionalita',
            label: 'Stagionalità',
            content: <SeasonalityPanel history={fullHistory} now={now} />,
          },
```

insert:

```tsx
          {
            id: 'dividendi',
            label: 'Dividendi',
            content: <DividendsPanel history={dividends} price={latest?.price ?? null} now={now} />,
          },
```

- [ ] **Step 6: Verify the whole project**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm test`
Expected: all tests pass — 435 (374 before this plan, 61 added: 13 + 17 + 14 + 6 + 5 + 6).

Run: `npx eslint lib/dividends.ts lib/dividend-text.ts components/Dividend*.tsx "app/stock/[symbol]/page.tsx"`
Expected: no output.

Run: `npx next build`
Expected: exit code 0; `/stock/[symbol]` is listed as partially prerendered, as before.

- [ ] **Step 7: Check the tab live**

If a dev server is already running (check with `lsof -i :3000`), use it and do not stop it; otherwise run `npm run dev` in the background and wait for "Ready". Then, for a symbol that is on the watchlist (NVDA was used for the earlier tabs):

Run: `curl -s http://localhost:3000/stock/NVDA | grep -o "Dividendi per anno\|Crescita del dividendo\|Questo titolo non distribuisce dividendi\|Dati sui dividendi non disponibili\|Dividendi" | sort | uniq -c`
Expected: the tab label `Dividendi`, and exactly one of the three bodies: `Dividendi per anno` (with or without `Crescita del dividendo`), `Questo titolo non distribuisce dividendi`, or `Dati sui dividendi non disponibili`. NVDA pays a small dividend, so `Dividendi per anno` is expected.

Stop only a server you started. If the page cannot be fetched this way, do not work around it: record in the ledger that the live check was not performed and say so in the final message. The look of the chart, the layout at 375 px, and an Italian (`.MI`) ticker cannot be checked with `curl`; report them as not verified.

- [ ] **Step 8: Commit**

```bash
git add components/DividendsPanel.tsx components/DividendsPanel.module.css tests/components/DividendsPanel.test.tsx "app/stock/[symbol]/page.tsx"
git commit -m "feat: add Dividendi tab with yearly totals, frequency, yield and growth"
```
