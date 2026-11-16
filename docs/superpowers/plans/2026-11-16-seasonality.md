# Seasonality Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Stagionalità" tab to the stock page that says, in one sentence and five blocks, whether this time of year has historically been good or bad for the stock.

**Architecture:** A new network-free module `lib/seasonality.ts` turns the full price history (already fetched by `getFullPriceHistory`) into monthly returns, per-month averages, an average seasonal curve, weekday averages and US presidential-cycle averages, computed for every look-back window (5 / 10 / 20 years / all). A server component `SeasonalityPanel` runs the calculation and hands the finished result to a client component `SeasonalityView`, which only holds the selected window and composes three small presentational components. No prices are sent to the browser for this tab.

**Tech Stack:** TypeScript, Next.js 16.4.6 App Router (`cacheComponents: true`), React 19, Vitest 5 + Testing Library (jsdom, `fireEvent`), CSS modules, hand-written SVG. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-seasonality-design.md`

## Global Constraints

- **Next.js here is not the Next.js you know** (`AGENTS.md`): before editing anything under `app/`, list `node_modules/next/dist/docs/` and read the guide on server and client components; heed deprecation notices. If `next dev` rewrites `AGENTS.md`, commit it with the work.
- `lib/seasonality.ts` is pure: no `fetch`, no `Date.now()`, no `new Date()` without an argument. The reference date always arrives as a `now: Date` parameter. All calendar math is in **UTC** (`getUTCFullYear`, `getUTCMonth`, `getUTCDate`, `getUTCDay`).
- Price basis: split-adjusted close, no dividends — whatever `getFullPriceHistory` returns. Do not touch `lib/history.ts` or `lib/performance.ts`.
- Percentages are plain numbers in percent units (`25` means 25%), named `...Pct`. Months are indexed `0` (January) to `11`. Weekdays are `1` (Monday) to `5` (Friday).
- No new npm dependency, no chart library, no Prisma migration, no new DB table.
- UI copy is Italian. Exact strings: tab label `Stagionalità`, tab id `stagionalita`; `Storico non disponibile al momento.`; `Storico troppo breve per la stagionalità.`; `Calcolato su tutto lo storico.`; window buttons `5 anni`, `10 anni`, `20 anni`, `Tutto`.
- Percentages are formatted with `formatPct` from `lib/performance.ts` (one decimal, `it-IT` comma, `+` for gains, the real minus sign `−` U+2212 for losses). Weekday averages are the one exception: they are a few hundredths of a percent, so they use two decimals (`formatDailyPct`, Task 6).
- Colors come from existing tokens in `app/globals.css` only: `--gain-bright`, `--loss-bright`, `--amber-bright`, `--ink`, `--surface`, `--surface-raised`, `--rule`, `--bone`, `--muted`, `--radius-card`, `--card-shadow`, `--font-ui`.
- The page must never scroll horizontally at phone width; only the month table scrolls, inside its own box.
- Tests cannot rely on CSS-module class names; components expose `data-*` attributes for the things tests check.
- Commit messages and code comments must not mention any AI tool or assistant, and must not carry `Co-Authored-By` or "Generated with" trailers.
- Work directly on `main`. Do not push.
- Run a single test file with `npx vitest run <path>`; typecheck with `npx tsc --noEmit`; lint with `npm run lint`. The full suite (`npm test`) needs the test Postgres from `.env.test`; it stood at 315 passing tests before this plan. `npm run lint` already reports 2 errors and 1 warning in `app/scopri/page.tsx` and `components/CompareSelection.tsx`; they predate this work — leave them.

## Review Focus

- **Stock listed mid-year, or with a month of no trading:** the missing month must be an empty cell and stay out of the averages; "X su N" must count only years that have a value. Pinned in Task 1 (`monthlyReturns`, `monthStats`).
- **History that is weekly or monthly instead of daily:** weekday averages must ignore those stretches, and the weekday block must disappear when nothing is left. Pinned in Tasks 1 and 6.
- **Suspended ticker whose last close is months old:** the current month must be an empty cell, not a `0,0%`, and the current-year curve must stay flat up to today. Pinned in Task 2.
- **Today is 29 February, or early January before the year's first close:** the today marker must land on 28 February; the current-year line must be absent without breaking the chart. Pinned in Tasks 2 and 4.
- **Every value zero or identical:** bars and curve must render without `NaN` and without dividing by zero. Pinned in Tasks 3 and 4.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/seasonality.ts` (create) | Pure calculations and the `seasonality(points, now)` entry point. |
| `components/SeasonalBars.tsx` + `.module.css` (create) | Generic list of horizontal diverging bars; used for months, weekdays and election cycle. |
| `components/SeasonalCurveChart.tsx` + `.module.css` (create) | SVG line chart: average curve, current-year curve, today marker. |
| `components/MonthlyReturnsTable.tsx` + `.module.css` (create) | Year × month table with toned cells. Exports `MONTH_SHORT`. |
| `components/SeasonalityView.tsx` + `.module.css` (create) | Client component: window selector, sentence about now, composition of the blocks. |
| `components/SeasonalityPanel.tsx` + `.module.css` (create) | Server component: runs `seasonality`, owns the two empty states and the data note. |
| `app/stock/[symbol]/page.tsx` (modify) | Add the `Stagionalità` tab after `Andamento`. |
| `tests/lib/seasonality.test.ts`, `tests/components/SeasonalBars.test.tsx`, `tests/components/SeasonalCurveChart.test.tsx`, `tests/components/MonthlyReturnsTable.test.tsx`, `tests/components/SeasonalityView.test.tsx`, `tests/components/SeasonalityPanel.test.tsx` (create) | Tests. |

Three refinements of the spec, already written back into it:

1. A year is complete when the series has data **in that year and in the year before** (a year with no trading at all is not complete).
2. The three bar blocks are horizontal bars in an HTML list, not SVG: values stay readable at phone width.
3. Weekday averages use two decimals, and the weekday block is hidden when the window has no daily data.

---

### Task 1: Monthly returns, complete years, month and weekday statistics

**Files:**
- Create: `lib/seasonality.ts`
- Test: `tests/lib/seasonality.test.ts` (create)

**Interfaces:**
- Consumes: `PricePoint { t: number; close: number }` from `lib/history.ts` (`t` in milliseconds, series ascending by `t`, closes positive).
- Produces:
  - `interface MonthStat { month: number; avgPct: number; positive: number; count: number }`
  - `interface WeekdayStat { weekday: number; avgPct: number; positiveSharePct: number; count: number }`
  - `monthlyReturns(points: PricePoint[]): Map<number, Array<number | null>>` — key is the year, value has 12 entries.
  - `completeYears(points: PricePoint[], now: Date): number[]` — ascending.
  - `monthStats(grid: Map<number, Array<number | null>>, years: number[]): MonthStat[]` — months with no value are left out.
  - `weekdayStats(points: PricePoint[], years: number[]): WeekdayStat[]` — Monday to Friday, weekdays with no data left out.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/seasonality.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PricePoint } from '@/lib/history'
import { completeYears, monthlyReturns, monthStats, weekdayStats } from '@/lib/seasonality'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const p = (iso: string, close: number): PricePoint => ({ t: at(iso), close })
const NOW = new Date('2026-11-16T09:00:00Z')

describe('monthlyReturns', () => {
  const grid = monthlyReturns([p('2025-11-28', 100), p('2025-12-30', 110), p('2025-12-31', 120), p('2026-01-30', 90), p('2026-03-31', 99)])

  it('measures each month from the last close of the month before', () => {
    expect(grid.get(2025)?.[11]).toBeCloseTo(20)
    expect(grid.get(2026)?.[0]).toBeCloseTo(-25)
  })

  it('leaves a month empty when it, or the month before, has no close', () => {
    expect(grid.get(2025)?.[10]).toBeNull()
    expect(grid.get(2026)?.[1]).toBeNull()
    expect(grid.get(2026)?.[2]).toBeNull()
    expect(grid.get(2026)).toHaveLength(12)
  })

  it('returns an empty grid for an empty series', () => {
    expect(monthlyReturns([]).size).toBe(0)
  })
})

describe('completeYears', () => {
  it('keeps past years that have data in that year and in the one before', () => {
    const points = [p('2019-12-31', 1), p('2020-12-31', 2), p('2022-12-30', 3), p('2023-12-29', 4)]
    expect(completeYears(points, NOW)).toEqual([2020, 2023])
  })

  it('never includes the year of now', () => {
    const points = [p('2024-12-31', 1), p('2025-12-31', 2), p('2026-06-30', 3)]
    expect(completeYears(points, NOW)).toEqual([2025])
  })
})

describe('monthStats', () => {
  const row = (jan: number | null, feb: number | null) => [jan, feb, ...new Array<number | null>(10).fill(null)]
  const grid = new Map([
    [2023, row(10, null)],
    [2024, row(-4, 6)],
    [2025, row(0, null)],
  ])

  it('averages each month over the years that have a value', () => {
    expect(monthStats(grid, [2023, 2024, 2025])).toEqual([
      { month: 0, avgPct: 2, positive: 1, count: 3 },
      { month: 1, avgPct: 6, positive: 1, count: 1 },
    ])
  })

  it('uses only the years asked for, and does not count zero as positive', () => {
    expect(monthStats(grid, [2024, 2025])).toEqual([
      { month: 0, avgPct: -2, positive: 0, count: 2 },
      { month: 1, avgPct: 6, positive: 1, count: 1 },
    ])
  })
})

describe('weekdayStats', () => {
  // 6 November 2026 is a Friday.
  const points = [
    p('2026-11-06', 100),
    p('2026-11-09', 110),
    p('2026-11-10', 99),
    p('2026-11-11', 99),
    p('2026-11-13', 108.9),
    p('2026-11-20', 200),
    p('2026-11-23', 220),
  ]

  it('averages daily returns by weekday and skips gaps longer than four days', () => {
    const stats = weekdayStats(points, [2026])
    expect(stats.map((s) => s.weekday)).toEqual([1, 2, 3, 5])
    expect(stats[0]).toMatchObject({ positiveSharePct: 100, count: 2 })
    expect(stats[0].avgPct).toBeCloseTo(10)
    expect(stats[1].avgPct).toBeCloseTo(-10)
    expect(stats[1].positiveSharePct).toBe(0)
    expect(stats[2]).toMatchObject({ avgPct: 0, positiveSharePct: 0, count: 1 })
    expect(stats[3].count).toBe(1)
    expect(stats[3].avgPct).toBeCloseTo(10)
  })

  it('gives the return over a long weekend to the day trading resumes', () => {
    const stats = weekdayStats([p('2026-11-13', 100), p('2026-11-17', 105)], [2026])
    expect(stats).toHaveLength(1)
    expect(stats[0].weekday).toBe(2)
    expect(stats[0].avgPct).toBeCloseTo(5)
  })

  it('ignores days outside the years asked for', () => {
    expect(weekdayStats(points, [2025])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/seasonality.test.ts`
Expected: FAIL — cannot resolve `@/lib/seasonality`.

- [ ] **Step 3: Write the implementation**

Create `lib/seasonality.ts`:

```ts
import type { PricePoint } from '@/lib/history'

const DAY_MS = 86_400_000
// Friday to Tuesday over a long weekend is four days; anything longer is not daily data.
const MAX_GAP_DAYS = 4

export interface MonthStat {
  month: number
  avgPct: number
  positive: number
  count: number
}

export interface WeekdayStat {
  weekday: number
  avgPct: number
  positiveSharePct: number
  count: number
}

function pct(value: number, reference: number): number {
  return (value / reference - 1) * 100
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

// Month-over-month return for every year with data; index 0 is January. A month with no close, or none the month before, is null.
export function monthlyReturns(points: PricePoint[]): Map<number, Array<number | null>> {
  const closes = new Map<number, number>()
  for (const point of points) {
    const date = new Date(point.t)
    closes.set(date.getUTCFullYear() * 12 + date.getUTCMonth(), point.close)
  }
  const grid = new Map<number, Array<number | null>>()
  for (const [key, close] of closes) {
    const year = Math.floor(key / 12)
    const row = grid.get(year) ?? new Array<number | null>(12).fill(null)
    const previous = closes.get(key - 1)
    if (previous !== undefined && previous > 0) row[key % 12] = pct(close, previous)
    grid.set(year, row)
  }
  return grid
}

// Years before the year of `now` with data both in that year and in the one before, oldest first.
export function completeYears(points: PricePoint[], now: Date): number[] {
  const withData = new Set(points.map((point) => new Date(point.t).getUTCFullYear()))
  const currentYear = now.getUTCFullYear()
  return [...withData].filter((year) => year < currentYear && withData.has(year - 1)).sort((a, b) => a - b)
}

export function monthStats(grid: Map<number, Array<number | null>>, years: number[]): MonthStat[] {
  const out: MonthStat[] = []
  for (let month = 0; month < 12; month++) {
    const values = years.map((year) => grid.get(year)?.[month] ?? null).filter((value): value is number => value !== null)
    if (values.length > 0) out.push({ month, avgPct: mean(values), positive: values.filter((value) => value > 0).length, count: values.length })
  }
  return out
}

// Average close-to-close return per weekday (1 Monday to 5 Friday) for the days falling in `years`.
export function weekdayStats(points: PricePoint[], years: number[]): WeekdayStat[] {
  const wanted = new Set(years)
  const buckets = new Map<number, number[]>()
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]
    const current = points[i]
    const date = new Date(current.t)
    const weekday = date.getUTCDay()
    if (weekday < 1 || weekday > 5 || !wanted.has(date.getUTCFullYear()) || previous.close <= 0) continue
    if (Math.floor(current.t / DAY_MS) - Math.floor(previous.t / DAY_MS) > MAX_GAP_DAYS) continue
    const bucket = buckets.get(weekday) ?? []
    bucket.push(pct(current.close, previous.close))
    buckets.set(weekday, bucket)
  }
  return [1, 2, 3, 4, 5].flatMap((weekday) => {
    const values = buckets.get(weekday)
    if (!values) return []
    return [{ weekday, avgPct: mean(values), positiveSharePct: (values.filter((value) => value > 0).length / values.length) * 100, count: values.length }]
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/seasonality.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/seasonality.ts tests/lib/seasonality.test.ts
git commit -m "feat: add monthly returns, month and weekday seasonality statistics"
```

---

### Task 2: Seasonal curve, presidential cycle and the `seasonality` entry point

**Files:**
- Modify: `lib/seasonality.ts` (append; the import line and the constants at the top are extended)
- Test: `tests/lib/seasonality.test.ts` (append)

**Interfaces:**
- Consumes: `monthlyReturns`, `completeYears`, `monthStats`, `weekdayStats`, `MonthStat`, `WeekdayStat` from Task 1; `yearlyReturns(points: PricePoint[], now: Date): { year: number; returnPct: number; partial: boolean }[]` from `lib/performance.ts`.
- Produces:
  - `type WindowKey = '5' | '10' | '20' | 'all'`
  - `type CycleKey = 'election' | 'post' | 'midterm' | 'pre'`
  - `interface SeasonalYear { year: number; months: Array<number | null>; returnPct: number | null; partial: boolean }`
  - `interface SeasonalWindow { key: WindowKey; fromYear: number; toYear: number; months: MonthStat[]; curve: number[]; weekdays: WeekdayStat[] }`
  - `interface CycleStat { key: CycleKey; avgPct: number; positive: number; count: number }`
  - `interface Seasonality { years: SeasonalYear[]; windows: SeasonalWindow[]; defaultWindow: WindowKey; currentYear: number; currentYearCurve: number[]; electionCycle: CycleStat[]; currentCycle: CycleKey; currentMonth: number; nextMonth: number; todayIndex: number }`
  - `yearCurve(yearPoints: PricePoint[], base: number, length?: number): number[]`
  - `seasonalCurve(points: PricePoint[], years: number[]): number[]` — 365 values, rounded to 2 decimals.
  - `electionCycle(points: PricePoint[], now: Date, years: number[]): CycleStat[]`
  - `seasonality(points: PricePoint[], now: Date): Seasonality | null`

Background for the implementer: the curve has one value per calendar day of a 365-day year. A day's position is its month offset plus its day of month, so 1 March is always index 59; 29 February has no slot and is skipped. `years` in the result is newest first: the current year (flagged `partial`) when it has data, then every complete year.

- [ ] **Step 1: Write the failing tests**

In `tests/lib/seasonality.test.ts`, replace the import of `@/lib/seasonality` with:

```ts
import { completeYears, electionCycle, monthlyReturns, monthStats, seasonalCurve, seasonality, weekdayStats, yearCurve } from '@/lib/seasonality'
```

and append at the end of the file:

```ts
// Every year: +10% by 31 January, +20% by 30 June, +100% by 31 December.
function yearly(fromYear: number, toYear: number): PricePoint[] {
  const out = [p(`${fromYear - 1}-12-31`, 100)]
  let base = 100
  for (let year = fromYear; year <= toYear; year++) {
    out.push(p(`${year}-01-31`, base * 1.1), p(`${year}-06-30`, base * 1.2), p(`${year}-12-31`, base * 2))
    base *= 2
  }
  return out
}

describe('yearCurve', () => {
  it('holds the last value between closes and starts at zero', () => {
    const curve = yearCurve([p('2025-01-31', 110), p('2025-06-30', 120), p('2025-12-31', 200)], 100)
    expect(curve).toHaveLength(365)
    expect(curve[0]).toBe(0)
    expect(curve[29]).toBe(0)
    expect(curve[30]).toBeCloseTo(10)
    expect(curve[179]).toBeCloseTo(10)
    expect(curve[180]).toBeCloseTo(20)
    expect(curve[363]).toBeCloseTo(20)
    expect(curve[364]).toBeCloseTo(100)
  })

  it('skips 29 February so every year has 365 days', () => {
    const curve = yearCurve([p('2024-02-28', 110), p('2024-02-29', 150), p('2024-03-01', 120)], 100)
    expect(curve).toHaveLength(365)
    expect(curve[58]).toBeCloseTo(10)
    expect(curve[59]).toBeCloseTo(20)
    expect(curve).not.toContain(50)
  })

  it('can stop at a given day', () => {
    const curve = yearCurve([p('2025-01-31', 110), p('2025-06-30', 120), p('2025-12-31', 200)], 100, 181)
    expect(curve).toHaveLength(181)
    expect(curve[180]).toBeCloseTo(20)
  })
})

describe('seasonalCurve', () => {
  it('equals a single year when every year moves the same way', () => {
    const curve = seasonalCurve(yearly(2020, 2025), [2023, 2024, 2025])
    expect(curve).toHaveLength(365)
    expect(curve[30]).toBeCloseTo(10)
    expect(curve[180]).toBeCloseTo(20)
    expect(curve[364]).toBeCloseTo(100)
  })

  it('averages the years day by day', () => {
    const points = [p('2022-12-30', 100), p('2023-06-30', 150), p('2023-12-29', 100), p('2024-06-28', 50), p('2024-12-31', 100)]
    const curve = seasonalCurve(points, [2023, 2024])
    expect(curve[177]).toBeCloseTo(0)
    expect(curve[178]).toBeCloseTo(-25)
    expect(curve[180]).toBeCloseTo(0)
    expect(curve[362]).toBeCloseTo(-25)
    expect(curve[364]).toBeCloseTo(0)
  })
})

describe('electionCycle', () => {
  it('groups yearly returns by position in the US presidential cycle', () => {
    const points = [p('2019-12-31', 100), p('2020-12-31', 50), p('2021-12-31', 100), p('2022-12-30', 100), p('2023-12-29', 110), p('2024-12-31', 220)]
    const cycle = electionCycle(points, NOW, [2020, 2021, 2022, 2023, 2024])
    expect(cycle.map((c) => c.key)).toEqual(['election', 'post', 'midterm', 'pre'])
    expect(cycle[0]).toMatchObject({ positive: 1, count: 2 })
    expect(cycle[0].avgPct).toBeCloseTo(25)
    expect(cycle[2]).toMatchObject({ avgPct: 0, positive: 0, count: 1 })
    expect(cycle[3].avgPct).toBeCloseTo(10)
  })

  it('leaves out a cycle year with no data', () => {
    const cycle = electionCycle(yearly(2021, 2023), NOW, [2021, 2022, 2023])
    expect(cycle.map((c) => c.key)).toEqual(['post', 'midterm', 'pre'])
  })
})

describe('seasonality', () => {
  // 100 at the end of 2013, doubling every year: 409600 at the end of 2025.
  const points = [...yearly(2014, 2025), p('2026-10-30', 409600 * 1.2), p('2026-11-13', 409600 * 1.5)]
  const result = seasonality(points, NOW)!

  it('offers the windows the history covers and defaults to ten years', () => {
    expect(result.windows.map((w) => w.key)).toEqual(['5', '10', 'all'])
    expect(result.defaultWindow).toBe('10')
    expect(result.windows.map((w) => [w.fromYear, w.toYear])).toEqual([
      [2021, 2025],
      [2016, 2025],
      [2014, 2025],
    ])
  })

  it.each([
    [2023, ['all'], 'all'],
    [2019, ['5', 'all'], 'all'],
    [2001, ['5', '10', '20', 'all'], '10'],
  ])('with history from %i offers %j and defaults to %s', (fromYear, keys, fallback) => {
    const short = seasonality(yearly(fromYear, 2025), NOW)!
    expect(short.windows.map((w) => w.key)).toEqual(keys)
    expect(short.defaultWindow).toBe(fallback)
  })

  it('returns null with fewer than three complete years, or no data', () => {
    expect(seasonality(yearly(2024, 2025), NOW)).toBeNull()
    expect(seasonality([], NOW)).toBeNull()
  })

  it('computes each window on its own years', () => {
    const ten = result.windows[1]
    expect(ten.months).toHaveLength(1)
    expect(ten.months[0]).toMatchObject({ month: 0, positive: 10, count: 10 })
    expect(ten.months[0].avgPct).toBeCloseTo(10)
    expect(result.windows[2].months[0].count).toBe(12)
    expect(ten.curve[364]).toBeCloseTo(100)
    expect(ten.weekdays).toEqual([])
  })

  it('lists the current year first, flagged partial, then complete years newest first', () => {
    expect(result.years).toHaveLength(13)
    expect(result.years[0]).toMatchObject({ year: 2026, partial: true })
    expect(result.years[0].months[9]).toBeNull()
    expect(result.years[0].months[10]).toBeCloseTo(25)
    expect(result.years[0].returnPct).toBeCloseTo(50)
    expect(result.years[1]).toMatchObject({ year: 2025, partial: false })
    expect(result.years[1].months[0]).toBeCloseTo(10)
    expect(result.years[1].months[5]).toBeNull()
    expect(result.years[1].returnPct).toBeCloseTo(100)
    expect(result.years[12].year).toBe(2014)
  })

  it('describes today: months to highlight, day of the year, cycle year', () => {
    expect(result).toMatchObject({ currentYear: 2026, currentMonth: 10, nextMonth: 11, todayIndex: 319, currentCycle: 'midterm' })
    expect(result.electionCycle.map((c) => c.count)).toEqual([3, 3, 3, 3])
  })

  it('draws the current year up to today', () => {
    expect(result.currentYearCurve).toHaveLength(320)
    expect(result.currentYearCurve[301]).toBe(0)
    expect(result.currentYearCurve[302]).toBeCloseTo(20)
    expect(result.currentYearCurve[316]).toBeCloseTo(50)
    expect(result.currentYearCurve[319]).toBeCloseTo(50)
  })

  it('follows December with January', () => {
    expect(seasonality(points, new Date('2026-12-10T09:00:00Z'))).toMatchObject({ currentMonth: 11, nextMonth: 0 })
  })

  it('puts the today marker on 28 February when today is 29 February', () => {
    expect(seasonality(yearly(2014, 2027), new Date('2028-02-29T09:00:00Z'))?.todayIndex).toBe(58)
  })

  it('has no current-year row or curve before the first close of the year', () => {
    const early = seasonality(yearly(2014, 2026), new Date('2027-01-01T09:00:00Z'))!
    expect(early.years[0]).toMatchObject({ year: 2026, partial: false })
    expect(early.currentYearCurve).toEqual([])
  })

  it('keeps a stale ticker flat: empty current month, last value held to today', () => {
    const stale = seasonality([...yearly(2014, 2025), p('2026-03-31', 409600 * 1.3)], NOW)!
    expect(stale.years[0].months[10]).toBeNull()
    expect(stale.currentYearCurve).toHaveLength(320)
    expect(stale.currentYearCurve[319]).toBeCloseTo(30)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/seasonality.test.ts`
Expected: FAIL — `yearCurve`, `seasonalCurve`, `electionCycle`, `seasonality` are not exported (the 10 tests of Task 1 may be reported as failed too, because the import breaks the whole file).

- [ ] **Step 3: Write the implementation**

In `lib/seasonality.ts`, replace the first line (`import type { PricePoint } from '@/lib/history'`) and the two constants below it with:

```ts
import type { PricePoint } from '@/lib/history'
import { yearlyReturns } from '@/lib/performance'

const DAY_MS = 86_400_000
// Friday to Tuesday over a long weekend is four days; anything longer is not daily data.
const MAX_GAP_DAYS = 4
const MIN_YEARS = 3
const FIXED_WINDOWS = [5, 10, 20] as const
const DAYS_IN_YEAR = 365
// Day-of-year offset of each month in a non-leap year.
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
// Indexed by year modulo 4: 2024 was a US presidential election year.
const CYCLE_KEYS = ['election', 'post', 'midterm', 'pre'] as const

export type WindowKey = '5' | '10' | '20' | 'all'
export type CycleKey = (typeof CYCLE_KEYS)[number]

export interface SeasonalYear {
  year: number
  months: Array<number | null>
  returnPct: number | null
  partial: boolean
}

export interface CycleStat {
  key: CycleKey
  avgPct: number
  positive: number
  count: number
}
```

Then append at the end of the file:

```ts
export interface SeasonalWindow {
  key: WindowKey
  fromYear: number
  toYear: number
  months: MonthStat[]
  curve: number[]
  weekdays: WeekdayStat[]
}

export interface Seasonality {
  years: SeasonalYear[]
  windows: SeasonalWindow[]
  defaultWindow: WindowKey
  currentYear: number
  currentYearCurve: number[]
  electionCycle: CycleStat[]
  currentCycle: CycleKey
  currentMonth: number
  nextMonth: number
  todayIndex: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function byYear(points: PricePoint[]): Map<number, PricePoint[]> {
  const groups = new Map<number, PricePoint[]>()
  for (const point of points) {
    const year = new Date(point.t).getUTCFullYear()
    const group = groups.get(year)
    if (group) group.push(point)
    else groups.set(year, [point])
  }
  return groups
}

function lastClose(points: PricePoint[] | undefined): number | null {
  const last = points?.[points.length - 1]
  return last && last.close > 0 ? last.close : null
}

// Position of a date in a 365-day year; 29 February has no slot.
function dayIndex(t: number): number | null {
  const date = new Date(t)
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  if (month === 1 && day === 29) return null
  return MONTH_START[month] + day - 1
}

// Return since `base` for each calendar day of one year: zero before the first close, then the last value seen.
export function yearCurve(yearPoints: PricePoint[], base: number, length = DAYS_IN_YEAR): number[] {
  const out = new Array<number>(length).fill(0)
  let cursor = 0
  let value = 0
  for (const point of yearPoints) {
    const index = dayIndex(point.t)
    if (index === null || index >= length) continue
    out.fill(value, cursor, index)
    value = pct(point.close, base)
    cursor = index
  }
  out.fill(value, cursor, length)
  return out
}

// Day-by-day average of the yearly curves of `years`, each measured from the last close of the year before.
export function seasonalCurve(points: PricePoint[], years: number[]): number[] {
  const groups = byYear(points)
  const sums = new Array<number>(DAYS_IN_YEAR).fill(0)
  let used = 0
  for (const year of years) {
    const base = lastClose(groups.get(year - 1))
    const own = groups.get(year)
    if (base === null || !own) continue
    yearCurve(own, base).forEach((value, i) => {
      sums[i] += value
    })
    used++
  }
  return sums.map((sum) => round2(used > 0 ? sum / used : 0))
}

export function electionCycle(points: PricePoint[], now: Date, years: number[]): CycleStat[] {
  const returns = new Map(yearlyReturns(points, now).map((entry) => [entry.year, entry.returnPct]))
  return CYCLE_KEYS.flatMap((key, remainder) => {
    const values = years
      .filter((year) => year % 4 === remainder)
      .map((year) => returns.get(year))
      .filter((value): value is number => value !== undefined)
    if (values.length === 0) return []
    return [{ key, avgPct: mean(values), positive: values.filter((value) => value > 0).length, count: values.length }]
  })
}

// Everything the seasonality tab shows, for every look-back window. Null when fewer than three complete years exist.
export function seasonality(points: PricePoint[], now: Date): Seasonality | null {
  const complete = completeYears(points, now)
  if (complete.length < MIN_YEARS) return null

  const currentYear = now.getUTCFullYear()
  const grid = monthlyReturns(points)
  const returns = new Map(yearlyReturns(points, now).map((entry) => [entry.year, entry.returnPct]))
  const row = (year: number, partial: boolean): SeasonalYear => ({
    year,
    months: grid.get(year) ?? new Array<number | null>(12).fill(null),
    returnPct: returns.get(year) ?? null,
    partial,
  })
  const years = [...complete].reverse().map((year) => row(year, false))
  if (grid.has(currentYear)) years.unshift(row(currentYear, true))

  const spans = FIXED_WINDOWS.filter((size) => complete.length >= size).map((size): [WindowKey, number[]] => [String(size) as WindowKey, complete.slice(-size)])
  spans.push(['all', complete])
  const windows = spans.map(([key, span]) => ({
    key,
    fromYear: span[0],
    toYear: span[span.length - 1],
    months: monthStats(grid, span),
    curve: seasonalCurve(points, span),
    weekdays: weekdayStats(points, span),
  }))

  const groups = byYear(points)
  // 29 February has no slot of its own: the marker stays on the 28th.
  const todayIndex = dayIndex(now.getTime()) ?? MONTH_START[2] - 1
  const base = lastClose(groups.get(currentYear - 1))
  const own = groups.get(currentYear)
  const currentMonth = now.getUTCMonth()

  return {
    years,
    windows,
    defaultWindow: windows.some((w) => w.key === '10') ? '10' : 'all',
    currentYear,
    currentYearCurve: base !== null && own ? yearCurve(own, base, todayIndex + 1).map(round2) : [],
    electionCycle: electionCycle(points, now, complete),
    currentCycle: CYCLE_KEYS[currentYear % 4],
    currentMonth,
    nextMonth: (currentMonth + 1) % 12,
    todayIndex,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/seasonality.test.ts`
Expected: PASS, 30 tests (10 from Task 1, 20 new; `it.each` counts as 3).

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/seasonality.ts tests/lib/seasonality.test.ts
git commit -m "feat: add seasonal curve, presidential cycle and seasonality summary"
```

---

### Task 3: `SeasonalBars` — horizontal diverging bars

**Files:**
- Create: `components/SeasonalBars.tsx`, `components/SeasonalBars.module.css`
- Test: `tests/components/SeasonalBars.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface SeasonalBar { key: string; label: string; valuePct: number; value: string; detail: string; highlight?: boolean }` — `value` is the already formatted percentage shown next to the bar.
  - `SeasonalBars({ bars, label }: { bars: SeasonalBar[]; label: string })` — a `<ul aria-label={label}>` with one `<li data-tone="gain|loss|flat" data-highlight="true|false">` per bar; the bar itself is the element with `data-bar`. Renders nothing for an empty list.

Background for the implementer: bars grow left or right from a centre line. The widest bar takes half the track (`50%`), the others are proportional. A plain HTML list keeps the numbers readable at phone width, where text inside a scaled SVG would be too small.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/SeasonalBars.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SeasonalBars } from '@/components/SeasonalBars'

const BARS = [
  { key: 'a', label: 'Gen', valuePct: 10, value: '+10,0%', detail: '8 su 10', highlight: true },
  { key: 'b', label: 'Feb', valuePct: -20, value: '−20,0%', detail: '3 su 10' },
  { key: 'c', label: 'Mar', valuePct: 0, value: '0,0%', detail: '0 su 10' },
]

const barOf = (row: HTMLElement) => row.querySelector('[data-bar]') as HTMLElement

describe('SeasonalBars', () => {
  it('lists one row per bar with label, value and detail', () => {
    render(<SeasonalBars bars={BARS} label="Rendimento medio per mese" />)
    const rows = within(screen.getByRole('list', { name: 'Rendimento medio per mese' })).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Gen')
    expect(rows[0]).toHaveTextContent('+10,0%')
    expect(rows[0]).toHaveTextContent('8 su 10')
  })

  it('tones rows by sign and marks highlighted ones', () => {
    render(<SeasonalBars bars={BARS} label="Mesi" />)
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-tone'))).toEqual(['gain', 'loss', 'flat'])
    expect(rows.map((r) => r.getAttribute('data-highlight'))).toEqual(['true', 'false', 'false'])
  })

  it('grows gains to the right and losses to the left of the centre, scaled to the largest', () => {
    render(<SeasonalBars bars={BARS} label="Mesi" />)
    const rows = screen.getAllByRole('listitem')
    expect(barOf(rows[0]).style.left).toBe('50%')
    expect(barOf(rows[0]).style.width).toBe('25%')
    expect(barOf(rows[1]).style.left).toBe('0%')
    expect(barOf(rows[1]).style.width).toBe('50%')
    expect(barOf(rows[2]).style.width).toBe('0%')
  })

  it('renders without NaN when every value is zero', () => {
    const { container } = render(<SeasonalBars bars={[{ key: 'a', label: 'Gen', valuePct: 0, value: '0,0%', detail: '0 su 3' }]} label="Mesi" />)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('renders nothing without bars', () => {
    const { container } = render(<SeasonalBars bars={[]} label="Mesi" />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/SeasonalBars.test.tsx`
Expected: FAIL — cannot resolve `@/components/SeasonalBars`.

- [ ] **Step 3: Write the implementation**

Create `components/SeasonalBars.tsx`:

```tsx
import styles from './SeasonalBars.module.css'

export interface SeasonalBar {
  key: string
  label: string
  valuePct: number
  value: string
  detail: string
  highlight?: boolean
}

export function SeasonalBars({ bars, label }: { bars: SeasonalBar[]; label: string }) {
  if (bars.length === 0) return null

  const maxAbs = Math.max(...bars.map((bar) => Math.abs(bar.valuePct))) || 1

  return (
    <ul className={styles.list} aria-label={label}>
      {bars.map((bar) => {
        // The largest bar fills half the track; bars start at the centre line.
        const width = (Math.abs(bar.valuePct) / maxAbs) * 50
        const left = bar.valuePct >= 0 ? 50 : 50 - width
        return (
          <li key={bar.key} className={styles.row} data-tone={bar.valuePct > 0 ? 'gain' : bar.valuePct < 0 ? 'loss' : 'flat'} data-highlight={bar.highlight ? 'true' : 'false'}>
            <span className={styles.label}>{bar.label}</span>
            <span className={styles.track} aria-hidden="true">
              <span data-bar className={styles.bar} style={{ left: `${left}%`, width: `${width}%` }} />
            </span>
            <span className={styles.value}>{bar.value}</span>
            <span className={styles.detail}>{bar.detail}</span>
          </li>
        )
      })}
    </ul>
  )
}
```

Create `components/SeasonalBars.module.css`:

```css
.list {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content max-content;
  gap: 4px 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}

.row {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: center;
  padding: 4px 8px;
  border-radius: 8px;
}

.row[data-highlight='true'] {
  background: var(--surface-raised);
  box-shadow: 0 0 0 1px var(--rule);
}

.label {
  color: var(--muted);
}

.row[data-highlight='true'] .label {
  color: var(--bone);
}

.track {
  position: relative;
  height: 12px;
}

.track::before {
  content: '';
  position: absolute;
  top: -3px;
  bottom: -3px;
  left: 50%;
  width: 1px;
  background: var(--rule);
}

.bar {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 3px;
}

.row[data-tone='gain'] .bar {
  background: var(--gain-bright);
}

.row[data-tone='loss'] .bar {
  background: var(--loss-bright);
}

.value {
  text-align: right;
  font-feature-settings: "tnum" 1;
}

.row[data-tone='gain'] .value {
  color: var(--gain-bright);
}

.row[data-tone='loss'] .value {
  color: var(--loss-bright);
}

.detail {
  text-align: right;
  font-size: 12px;
  color: var(--muted);
  font-feature-settings: "tnum" 1;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/SeasonalBars.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add components/SeasonalBars.tsx components/SeasonalBars.module.css tests/components/SeasonalBars.test.tsx
git commit -m "feat: add horizontal diverging bar list for seasonality blocks"
```

---

### Task 4: `SeasonalCurveChart`

**Files:**
- Create: `components/SeasonalCurveChart.tsx`, `components/SeasonalCurveChart.module.css`
- Test: `tests/components/SeasonalCurveChart.test.tsx` (create)

**Interfaces:**
- Consumes: `formatPct(value: number): string` from `lib/performance.ts`.
- Produces: `SeasonalCurveChart({ curve, current, todayIndex, year }: { curve: number[]; current: number[]; todayIndex: number; year: number })` — `curve` has 365 values (average), `current` has one value per day of the current year up to today (possibly empty), `year` labels the current-year line. Renders nothing when `curve` is empty.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/SeasonalCurveChart.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeasonalCurveChart } from '@/components/SeasonalCurveChart'

const CURVE = Array.from({ length: 365 }, (_, i) => (i / 364) * 10)
const CURRENT = [0, -1, -2]
const pointCount = (el: Element | null) => el?.getAttribute('points')?.split(' ').length

describe('SeasonalCurveChart', () => {
  it('draws the average curve, the current year and the today marker', () => {
    const { container } = render(<SeasonalCurveChart curve={CURVE} current={CURRENT} todayIndex={2} year={2026} />)
    expect(pointCount(container.querySelector('[data-series="average"]'))).toBe(365)
    expect(pointCount(container.querySelector('[data-series="current"]'))).toBe(3)
    expect(container.querySelector('[data-role="today"]')).toBeInTheDocument()
    expect(container.querySelectorAll('text')).toHaveLength(12)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('summarises the chart in its accessible name and labels the lines', () => {
    render(<SeasonalCurveChart curve={CURVE} current={CURRENT} todayIndex={2} year={2026} />)
    expect(screen.getByRole('img', { name: 'Curva stagionale media: fine anno a +10,0%. 2026 finora: −2,0%.' })).toBeInTheDocument()
    expect(screen.getByText('Media')).toBeInTheDocument()
    expect(screen.getByText('2026')).toBeInTheDocument()
  })

  it('omits the current-year line when the year has no close yet', () => {
    const { container } = render(<SeasonalCurveChart curve={CURVE} current={[]} todayIndex={0} year={2027} />)
    expect(container.querySelector('[data-series="current"]')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Curva stagionale media: fine anno a +10,0%.' })).toBeInTheDocument()
    expect(screen.queryByText('2027')).not.toBeInTheDocument()
    expect(container.querySelector('[data-role="today"]')).toBeInTheDocument()
  })

  it('renders without NaN when the curve is flat at zero', () => {
    const { container } = render(<SeasonalCurveChart curve={new Array(365).fill(0)} current={[0, 0]} todayIndex={1} year={2026} />)
    expect(container.innerHTML).not.toContain('NaN')
  })

  it('renders nothing without a curve', () => {
    const { container } = render(<SeasonalCurveChart curve={[]} current={[]} todayIndex={0} year={2026} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/SeasonalCurveChart.test.tsx`
Expected: FAIL — cannot resolve `@/components/SeasonalCurveChart`.

- [ ] **Step 3: Write the implementation**

Create `components/SeasonalCurveChart.tsx`:

```tsx
import { formatPct } from '@/lib/performance'
import styles from './SeasonalCurveChart.module.css'

const W = 640
const H = 220
const PAD = { top: 12, right: 8, bottom: 22, left: 8 }
// Day-of-year offset of each month in a non-leap year.
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
const MONTH_LETTERS = ['G', 'F', 'M', 'A', 'M', 'G', 'L', 'A', 'S', 'O', 'N', 'D']

export function SeasonalCurveChart({ curve, current, todayIndex, year }: { curve: number[]; current: number[]; todayIndex: number; year: number }) {
  if (curve.length === 0) return null

  const max = Math.max(0, ...curve, ...current)
  const min = Math.min(0, ...curve, ...current)
  const span = max - min || 1
  const lastIndex = Math.max(curve.length - 1, 1)
  const x = (i: number) => PAD.left + (i / lastIndex) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + ((max - v) / span) * (H - PAD.top - PAD.bottom)
  const path = (values: number[]) => values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const todayX = x(Math.min(todayIndex, curve.length - 1))
  const label = `Curva stagionale media: fine anno a ${formatPct(curve[curve.length - 1])}.${current.length > 0 ? ` ${year} finora: ${formatPct(current[current.length - 1])}.` : ''}`

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={label}>
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className={styles.zero} />
        <line data-role="today" x1={todayX} x2={todayX} y1={PAD.top} y2={H - PAD.bottom} className={styles.today} />
        <polyline data-series="average" points={path(curve)} className={styles.average} fill="none" />
        {current.length > 0 && <polyline data-series="current" points={path(current)} className={styles.current} fill="none" />}
        {MONTH_LETTERS.map((letter, month) => (
          <text key={month} x={x(MONTH_START[month] + 15)} y={H - 6} textAnchor="middle" className={styles.axis}>
            {letter}
          </text>
        ))}
      </svg>
      <p className={styles.legend}>
        <span className={styles.key} data-series="average">
          Media
        </span>
        {current.length > 0 && (
          <span className={styles.key} data-series="current">
            {year}
          </span>
        )}
        <span>Linea tratteggiata: oggi</span>
      </p>
    </div>
  )
}
```

Create `components/SeasonalCurveChart.module.css`:

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

.today {
  stroke: var(--muted);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.average {
  stroke: var(--bone);
  stroke-width: 2;
  stroke-linejoin: round;
}

.current {
  stroke: var(--amber-bright);
  stroke-width: 2;
  stroke-linejoin: round;
}

.axis {
  font-size: 10px;
  fill: var(--muted);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}

.key::before {
  content: '';
  display: inline-block;
  width: 12px;
  height: 2px;
  margin-right: 6px;
  vertical-align: middle;
  background: var(--bone);
}

.key[data-series='current']::before {
  background: var(--amber-bright);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/SeasonalCurveChart.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add components/SeasonalCurveChart.tsx components/SeasonalCurveChart.module.css tests/components/SeasonalCurveChart.test.tsx
git commit -m "feat: add seasonal curve chart with current year and today marker"
```

---

### Task 5: `MonthlyReturnsTable`

**Files:**
- Create: `components/MonthlyReturnsTable.tsx`, `components/MonthlyReturnsTable.module.css`
- Test: `tests/components/MonthlyReturnsTable.test.tsx` (create)

**Interfaces:**
- Consumes: `SeasonalYear { year: number; months: Array<number | null>; returnPct: number | null; partial: boolean }` from `lib/seasonality.ts` (Task 2); `formatPct` from `lib/performance.ts`.
- Produces:
  - `MONTH_SHORT: string[]` — `['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']`.
  - `MonthlyReturnsTable({ rows, currentMonth }: { rows: SeasonalYear[]; currentMonth: number })` — one body row per entry of `rows`, in the order given. Cells carry `data-tone="gain|loss|flat"` and `data-partial="true|false"`; a missing value is an empty cell with `data-empty="true"`. In a `partial` row, the cell of `currentMonth` and the year total are partial. Renders nothing for no rows.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/MonthlyReturnsTable.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MonthlyReturnsTable } from '@/components/MonthlyReturnsTable'

const ROWS = [
  { year: 2026, months: [5, -2, 0, 1, 1, 1, 1, 1, 1, 1, -3, null], returnPct: 12, partial: true },
  { year: 2025, months: [1, null, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], returnPct: -8, partial: false },
]

function cells(year: string) {
  const row = screen.getByRole('rowheader', { name: year }).closest('tr') as HTMLElement
  return within(row).getAllByRole('cell')
}

describe('MonthlyReturnsTable', () => {
  it('shows one row per year with twelve months and the year total', () => {
    render(<MonthlyReturnsTable rows={ROWS} currentMonth={10} />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Anno', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic', 'Totale'])
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['2026', '2025'])
    expect(cells('2026')).toHaveLength(13)
    expect(cells('2026')[0]).toHaveTextContent('+5,0%')
    expect(cells('2025')[12]).toHaveTextContent('−8,0%')
  })

  it('tones cells by sign', () => {
    render(<MonthlyReturnsTable rows={ROWS} currentMonth={10} />)
    expect(cells('2026').slice(0, 3).map((c) => c.getAttribute('data-tone'))).toEqual(['gain', 'loss', 'flat'])
    expect(cells('2025')[12]).toHaveAttribute('data-tone', 'loss')
  })

  it('leaves missing months empty', () => {
    render(<MonthlyReturnsTable rows={ROWS} currentMonth={10} />)
    expect(cells('2025')[1]).toBeEmptyDOMElement()
    expect(cells('2025')[1]).toHaveAttribute('data-empty', 'true')
    expect(cells('2026')[11]).toBeEmptyDOMElement()
  })

  it('marks the running month and the running year total as partial', () => {
    render(<MonthlyReturnsTable rows={ROWS} currentMonth={10} />)
    expect(cells('2026')[10]).toHaveAttribute('data-partial', 'true')
    expect(cells('2026')[12]).toHaveAttribute('data-partial', 'true')
    expect(cells('2026')[0]).toHaveAttribute('data-partial', 'false')
    expect(cells('2025')[10]).toHaveAttribute('data-partial', 'false')
    expect(cells('2025')[12]).toHaveAttribute('data-partial', 'false')
  })

  it('renders nothing without rows', () => {
    const { container } = render(<MonthlyReturnsTable rows={[]} currentMonth={10} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/MonthlyReturnsTable.test.tsx`
Expected: FAIL — cannot resolve `@/components/MonthlyReturnsTable`.

- [ ] **Step 3: Write the implementation**

Create `components/MonthlyReturnsTable.tsx`:

```tsx
import { formatPct } from '@/lib/performance'
import type { SeasonalYear } from '@/lib/seasonality'
import styles from './MonthlyReturnsTable.module.css'

export const MONTH_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

function Cell({ value, partial }: { value: number | null; partial: boolean }) {
  if (value === null) return <td data-empty="true" />
  return (
    <td data-tone={value > 0 ? 'gain' : value < 0 ? 'loss' : 'flat'} data-partial={partial ? 'true' : 'false'}>
      {formatPct(value)}
    </td>
  )
}

export function MonthlyReturnsTable({ rows, currentMonth }: { rows: SeasonalYear[]; currentMonth: number }) {
  if (rows.length === 0) return null

  return (
    <div className={styles.scroll}>
      <table className={styles.table} aria-label="Rendimento mese per mese">
        <thead>
          <tr>
            <th scope="col">Anno</th>
            {MONTH_SHORT.map((month) => (
              <th key={month} scope="col">
                {month}
              </th>
            ))}
            <th scope="col">Totale</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <th scope="row">{row.year}</th>
              {row.months.map((value, month) => (
                <Cell key={month} value={value} partial={row.partial && month === currentMonth} />
              ))}
              <Cell value={row.returnPct} partial={row.partial} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

Create `components/MonthlyReturnsTable.module.css`:

```css
.scroll {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 2px;
  font-size: 12px;
  white-space: nowrap;
  font-feature-settings: "tnum" 1;
}

.table th {
  padding: 4px 6px;
  font-weight: 500;
  color: var(--muted);
  text-align: right;
}

.table th[scope='row'] {
  position: sticky;
  left: 0;
  background: var(--surface);
  text-align: left;
}

.table td {
  padding: 4px 6px;
  border-radius: 6px;
  text-align: right;
}

.table td[data-tone='gain'] {
  color: var(--gain-bright);
  background: color-mix(in srgb, var(--gain-bright) 14%, transparent);
}

.table td[data-tone='loss'] {
  color: var(--loss-bright);
  background: color-mix(in srgb, var(--loss-bright) 14%, transparent);
}

.table td[data-tone='flat'] {
  color: var(--muted);
}

.table td[data-partial='true'] {
  opacity: 0.55;
}

.table td:last-child,
.table th:last-child {
  font-weight: 600;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/MonthlyReturnsTable.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add components/MonthlyReturnsTable.tsx components/MonthlyReturnsTable.module.css tests/components/MonthlyReturnsTable.test.tsx
git commit -m "feat: add year-by-month returns table"
```

---

### Task 6: `SeasonalityView`, `SeasonalityPanel` and the `Stagionalità` tab

**Files:**
- Create: `components/SeasonalityView.tsx`, `components/SeasonalityView.module.css`, `components/SeasonalityPanel.tsx`, `components/SeasonalityPanel.module.css`
- Modify: `app/stock/[symbol]/page.tsx` (one import; one entry in the `tabs` array of `<StockTabs>`, right after the `andamento` entry)
- Test: `tests/components/SeasonalityView.test.tsx`, `tests/components/SeasonalityPanel.test.tsx` (create)

**Interfaces:**
- Consumes:
  - From `lib/seasonality.ts`: `seasonality(points, now): Seasonality | null`, types `Seasonality`, `SeasonalWindow`, `MonthStat`, `WindowKey`, `CycleKey` (shapes in Task 2's Interfaces).
  - `SeasonalBars`, `SeasonalBar` (Task 3); `SeasonalCurveChart` (Task 4); `MonthlyReturnsTable`, `MONTH_SHORT` (Task 5).
  - `FullHistory { points: PricePoint[]; sparseBefore: number | null }` from `lib/history.ts`; `formatPct` from `lib/performance.ts`.
  - In `app/stock/[symbol]/page.tsx`, the watchlist page already has `fullHistory` (a `FullHistory`) and `now` (a `Date`) in scope, used by `<PerformancePanel history={fullHistory} now={now} />`.
- Produces:
  - `SeasonalityView({ data }: { data: Seasonality })` — client component.
  - `SeasonalityPanel({ history, now }: { history: FullHistory; now: Date })` — server component.

Background for the implementer: the view shows, top to bottom, a card with the window selector and the sentence about the current and next month; the seasonal curve; month bars; the year-by-month table; weekday bars; presidential-cycle bars. The selector changes everything except the cycle block, which always uses the whole history. The month block and the weekday block are hidden when the selected window has no statistics for them. The table shows the current-year row (the one flagged `partial`) plus the years of the selected window.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/SeasonalityView.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SeasonalityView } from '@/components/SeasonalityView'
import type { MonthStat, Seasonality, SeasonalWindow, WindowKey } from '@/lib/seasonality'

const ramp = (end: number) => Array.from({ length: 365 }, (_, i) => (i / 364) * end)
const stat = (month: number, avgPct: number, positive: number, count: number): MonthStat => ({ month, avgPct, positive, count })
const WEEKDAYS = [
  { weekday: 1, avgPct: 0.12, positiveSharePct: 55.4, count: 500 },
  { weekday: 5, avgPct: -0.05, positiveSharePct: 48, count: 498 },
]
const win = (key: WindowKey, fromYear: number, toYear: number, months: MonthStat[], weekdays = WEEKDAYS): SeasonalWindow => ({ key, fromYear, toYear, months, curve: ramp(10), weekdays })
const yearRow = (year: number, partial = false) => ({ year, months: Array.from({ length: 12 }, (_, m) => (partial && m > 10 ? null : m + 1)), returnPct: 20, partial })

const TEN = [stat(0, 1.5, 6, 10), stat(10, 4.2, 8, 10), stat(11, 1.1, 6, 10)]
const DATA: Seasonality = {
  years: [yearRow(2026, true), ...Array.from({ length: 10 }, (_, i) => yearRow(2025 - i))],
  windows: [win('5', 2021, 2025, [stat(0, 1, 3, 5), stat(10, 2, 3, 5), stat(11, -1, 2, 5)]), win('10', 2016, 2025, TEN), win('all', 2016, 2025, TEN)],
  defaultWindow: '10',
  currentYear: 2026,
  currentYearCurve: ramp(5).slice(0, 320),
  electionCycle: [
    { key: 'election', avgPct: 12, positive: 2, count: 3 },
    { key: 'midterm', avgPct: -4, positive: 1, count: 3 },
  ],
  currentCycle: 'midterm',
  currentMonth: 10,
  nextMonth: 11,
  todayIndex: 319,
}

const items = (name: string) => within(screen.getByRole('list', { name })).getAllByRole('listitem')

describe('SeasonalityView', () => {
  it('opens on the default window with its period and its sentence about now', () => {
    render(<SeasonalityView data={DATA} />)
    expect(screen.getByRole('button', { name: '10 anni' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '5 anni' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('2016–2025')).toBeInTheDocument()
    expect(screen.getByText('Novembre è stato positivo 8 anni su 10, in media +4,2%. Dicembre: 6 su 10, in media +1,1%.')).toBeInTheDocument()
  })

  it('offers only the windows the history covers', () => {
    render(<SeasonalityView data={DATA} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['5 anni', '10 anni', 'Tutto'])
  })

  it('recomputes sentence, bars and table rows when another window is chosen', () => {
    render(<SeasonalityView data={DATA} />)
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(12)
    fireEvent.click(screen.getByRole('button', { name: '5 anni' }))
    expect(screen.getByRole('button', { name: '5 anni' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('2021–2025')).toBeInTheDocument()
    expect(screen.getByText('Novembre è stato positivo 3 anni su 5, in media +2,0%. Dicembre: 2 su 5, in media −1,0%.')).toBeInTheDocument()
    expect(items('Rendimento medio per mese')[1]).toHaveTextContent('3 su 5')
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(7)
    expect(screen.getByRole('rowheader', { name: '2026' })).toBeInTheDocument()
    expect(screen.queryByRole('rowheader', { name: '2020' })).not.toBeInTheDocument()
  })

  it('highlights the current and the next month', () => {
    render(<SeasonalityView data={DATA} />)
    const rows = items('Rendimento medio per mese')
    expect(rows.map((r) => r.getAttribute('data-highlight'))).toEqual(['false', 'true', 'true'])
    expect(rows[1]).toHaveTextContent('Nov')
    expect(rows[1]).toHaveTextContent('+4,2%')
    expect(rows[1]).toHaveTextContent('8 su 10')
  })

  it('shows weekday averages with two decimals and the share of positive days', () => {
    render(<SeasonalityView data={DATA} />)
    const rows = items('Rendimento medio per giorno della settimana')
    expect(rows[0]).toHaveTextContent('Lunedì')
    expect(rows[0]).toHaveTextContent('+0,12%')
    expect(rows[0]).toHaveTextContent('55% positivi')
    expect(rows[1]).toHaveTextContent('Venerdì')
    expect(rows[1]).toHaveTextContent('−0,05%')
  })

  it('shows the presidential cycle on the whole history and highlights the current cycle year', () => {
    render(<SeasonalityView data={DATA} />)
    const rows = items('Rendimento annuo medio per anno del ciclo presidenziale USA')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Elezione')
    expect(rows[0]).toHaveAttribute('data-highlight', 'false')
    expect(rows[1]).toHaveTextContent('Metà mandato')
    expect(rows[1]).toHaveTextContent('−4,0%')
    expect(rows[1]).toHaveTextContent('1 su 3')
    expect(rows[1]).toHaveAttribute('data-highlight', 'true')
    expect(screen.getByText('Calcolato su tutto lo storico.')).toBeInTheDocument()
  })

  it('draws the seasonal curve with the current year', () => {
    render(<SeasonalityView data={DATA} />)
    expect(screen.getByRole('img', { name: /Curva stagionale media: fine anno a \+10,0%\. 2026 finora/ })).toBeInTheDocument()
  })

  it('uses the singular for one positive year and drops a month without statistics', () => {
    render(<SeasonalityView data={{ ...DATA, windows: [win('all', 2023, 2025, [stat(10, 2, 1, 3)])], defaultWindow: 'all' }} />)
    expect(screen.getByText('Novembre è stato positivo 1 anno su 3, in media +2,0%.')).toBeInTheDocument()
  })

  it('hides the sentence, the month block and the weekday block when the window has no statistics for them', () => {
    render(<SeasonalityView data={{ ...DATA, windows: [win('all', 2023, 2025, [], [])], defaultWindow: 'all' }} />)
    expect(screen.queryByText(/è stato positivo/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Rendimento medio per mese' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Giorno della settimana' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Curva stagionale' })).toBeInTheDocument()
  })
})
```

Create `tests/components/SeasonalityPanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeasonalityPanel } from '@/components/SeasonalityPanel'

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`)
const NOW = new Date('2026-11-16T09:00:00Z')

// Every year: +10% by 31 January, +20% by 30 June, +100% by 31 December.
function yearly(fromYear: number, toYear: number) {
  const out = [{ t: at(`${fromYear - 1}-12-31`), close: 100 }]
  let base = 100
  for (let year = fromYear; year <= toYear; year++) {
    out.push({ t: at(`${year}-01-31`), close: base * 1.1 }, { t: at(`${year}-06-30`), close: base * 1.2 }, { t: at(`${year}-12-31`), close: base * 2 })
    base *= 2
  }
  return out
}

describe('SeasonalityPanel', () => {
  it('renders the seasonality blocks from a price history', () => {
    render(<SeasonalityPanel history={{ points: yearly(2014, 2025), sparseBefore: null }} now={NOW} />)
    expect(screen.getByRole('button', { name: '10 anni' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Curva stagionale' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rendimento medio per mese' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Anno per mese' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ciclo presidenziale USA' })).toBeInTheDocument()
    expect(screen.getByText(/La stagionalità descrive il passato, non è una previsione/)).toBeInTheDocument()
    expect(screen.queryByText(/meno fitti/)).not.toBeInTheDocument()
  })

  it('hides the weekday block when the history has no daily data', () => {
    render(<SeasonalityPanel history={{ points: yearly(2014, 2025), sparseBefore: null }} now={NOW} />)
    expect(screen.queryByRole('heading', { name: 'Giorno della settimana' })).not.toBeInTheDocument()
  })

  it('shows the unavailable message without a history', () => {
    render(<SeasonalityPanel history={{ points: [], sparseBefore: null }} now={NOW} />)
    expect(screen.getByText('Storico non disponibile al momento.')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('shows the too-short message with fewer than three complete years', () => {
    render(<SeasonalityPanel history={{ points: yearly(2024, 2025), sparseBefore: null }} now={NOW} />)
    expect(screen.getByText('Storico troppo breve per la stagionalità.')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('warns when old data is sparser than daily', () => {
    render(<SeasonalityPanel history={{ points: yearly(2014, 2025), sparseBefore: at('2016-11-16') }} now={NOW} />)
    expect(screen.getByText(/Prima del 16 novembre 2016 i dati sono meno fitti/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/SeasonalityView.test.tsx tests/components/SeasonalityPanel.test.tsx`
Expected: FAIL — cannot resolve `@/components/SeasonalityView` and `@/components/SeasonalityPanel`.

- [ ] **Step 3: Write `SeasonalityView`**

Create `components/SeasonalityView.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { formatPct } from '@/lib/performance'
import type { CycleKey, MonthStat, Seasonality, WindowKey } from '@/lib/seasonality'
import { MONTH_SHORT, MonthlyReturnsTable } from '@/components/MonthlyReturnsTable'
import { SeasonalBars } from '@/components/SeasonalBars'
import { SeasonalCurveChart } from '@/components/SeasonalCurveChart'
import styles from './SeasonalityView.module.css'

const WINDOW_LABEL: Record<WindowKey, string> = { '5': '5 anni', '10': '10 anni', '20': '20 anni', all: 'Tutto' }
const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
// Indexed by weekday number: 1 is Monday.
const WEEKDAY_NAMES = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì']
const CYCLE_LABEL: Record<CycleKey, string> = { election: 'Elezione', post: 'Post-elezione', midterm: 'Metà mandato', pre: 'Pre-elezione' }

// Daily averages are a few hundredths of a percent: one decimal would round most of them to zero.
function formatDailyPct(value: number): string {
  const rounded = Number(value.toFixed(2))
  const body = Math.abs(rounded).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${body}%`
}

function monthPhrase(stat: MonthStat, lead: boolean): string {
  const name = MONTH_NAMES[stat.month]
  const average = `in media ${formatPct(stat.avgPct)}.`
  return lead ? `${name} è stato positivo ${stat.positive} ${stat.positive === 1 ? 'anno' : 'anni'} su ${stat.count}, ${average}` : `${name}: ${stat.positive} su ${stat.count}, ${average}`
}

export function SeasonalityView({ data }: { data: Seasonality }) {
  const [windowKey, setWindowKey] = useState<WindowKey>(data.defaultWindow)
  const active = data.windows.find((w) => w.key === windowKey) ?? data.windows[0]
  if (!active) return null

  const sentence = [data.currentMonth, data.nextMonth]
    .map((month) => active.months.find((stat) => stat.month === month))
    .filter((stat): stat is MonthStat => stat !== undefined)
    .map((stat, i) => monthPhrase(stat, i === 0))
    .join(' ')
  const rows = data.years.filter((row) => row.partial || (row.year >= active.fromYear && row.year <= active.toYear))

  return (
    <>
      <section className={styles.card} aria-label="Anni considerati">
        <div className={styles.top}>
          <div className={styles.windows} role="group" aria-label="Anni considerati">
            {data.windows.map((w) => (
              <button key={w.key} type="button" aria-pressed={w.key === active.key} className={`${styles.window} ${w.key === active.key ? styles.windowActive : ''}`} onClick={() => setWindowKey(w.key)}>
                {WINDOW_LABEL[w.key]}
              </button>
            ))}
          </div>
          <span className={styles.period}>{`${active.fromYear}–${active.toYear}`}</span>
        </div>
        {sentence && <p className={styles.sentence}>{sentence}</p>}
      </section>

      <section className={styles.card} aria-labelledby="seasonal-curve-title">
        <h2 id="seasonal-curve-title" className={styles.title}>
          Curva stagionale
        </h2>
        <SeasonalCurveChart curve={active.curve} current={data.currentYearCurve} todayIndex={data.todayIndex} year={data.currentYear} />
      </section>

      {active.months.length > 0 && (
        <section className={styles.card} aria-labelledby="seasonal-months-title">
          <h2 id="seasonal-months-title" className={styles.title}>
            Rendimento medio per mese
          </h2>
          <SeasonalBars
            label="Rendimento medio per mese"
            bars={active.months.map((stat) => ({
              key: String(stat.month),
              label: MONTH_SHORT[stat.month],
              valuePct: stat.avgPct,
              value: formatPct(stat.avgPct),
              detail: `${stat.positive} su ${stat.count}`,
              highlight: stat.month === data.currentMonth || stat.month === data.nextMonth,
            }))}
          />
          <p className={styles.hint}>A destra: anni positivi sul totale. Evidenziati il mese in corso e il successivo.</p>
        </section>
      )}

      <section className={styles.card} aria-labelledby="seasonal-table-title">
        <h2 id="seasonal-table-title" className={styles.title}>
          Anno per mese
        </h2>
        <MonthlyReturnsTable rows={rows} currentMonth={data.currentMonth} />
      </section>

      {active.weekdays.length > 0 && (
        <section className={styles.card} aria-labelledby="seasonal-weekdays-title">
          <h2 id="seasonal-weekdays-title" className={styles.title}>
            Giorno della settimana
          </h2>
          <SeasonalBars
            label="Rendimento medio per giorno della settimana"
            bars={active.weekdays.map((stat) => ({
              key: String(stat.weekday),
              label: WEEKDAY_NAMES[stat.weekday],
              valuePct: stat.avgPct,
              value: formatDailyPct(stat.avgPct),
              detail: `${Math.round(stat.positiveSharePct)}% positivi`,
            }))}
          />
        </section>
      )}

      {data.electionCycle.length > 0 && (
        <section className={styles.card} aria-labelledby="seasonal-cycle-title">
          <h2 id="seasonal-cycle-title" className={styles.title}>
            Ciclo presidenziale USA
          </h2>
          <p className={styles.hint}>Calcolato su tutto lo storico.</p>
          <SeasonalBars
            label="Rendimento annuo medio per anno del ciclo presidenziale USA"
            bars={data.electionCycle.map((stat) => ({
              key: stat.key,
              label: CYCLE_LABEL[stat.key],
              valuePct: stat.avgPct,
              value: formatPct(stat.avgPct),
              detail: `${stat.positive} su ${stat.count}`,
              highlight: stat.key === data.currentCycle,
            }))}
          />
        </section>
      )}
    </>
  )
}
```

Create `components/SeasonalityView.module.css`:

```css
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

.top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.windows {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 12px;
  background: var(--surface-raised);
}

.window {
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  background: none;
  color: var(--muted);
  font-family: var(--font-ui);
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.window:hover {
  color: var(--bone);
}

.windowActive {
  color: var(--bone);
  background: var(--ink);
  box-shadow: 0 0 0 1px var(--rule);
}

.period {
  font-size: 13px;
  color: var(--muted);
  font-feature-settings: "tnum" 1;
}

.sentence {
  margin-top: 14px;
  font-size: 16px;
  line-height: 1.5;
  max-width: 75ch;
}

.hint {
  margin: 8px 0;
  font-size: 12px;
  color: var(--muted);
}
```

- [ ] **Step 4: Write `SeasonalityPanel`**

Create `components/SeasonalityPanel.tsx`:

```tsx
import type { FullHistory } from '@/lib/history'
import { seasonality } from '@/lib/seasonality'
import { SeasonalityView } from '@/components/SeasonalityView'
import styles from './SeasonalityPanel.module.css'

export function SeasonalityPanel({ history, now }: { history: FullHistory; now: Date }) {
  const { points, sparseBefore } = history
  if (points.length === 0) return <p className={styles.empty}>Storico non disponibile al momento.</p>

  const data = seasonality(points, now)
  if (!data) return <p className={styles.empty}>Storico troppo breve per la stagionalità.</p>

  return (
    <div className={styles.panel}>
      <SeasonalityView data={data} />
      <p className={styles.note}>
        Prezzi di chiusura corretti per gli split, dividendi esclusi. Fonte: Yahoo Finance. La stagionalità descrive il passato, non è una previsione.
        {sparseBefore !== null &&
          ` Prima del ${new Date(sparseBefore).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} i dati sono meno fitti di quelli giornalieri.`}
      </p>
    </div>
  )
}
```

Create `components/SeasonalityPanel.module.css`:

```css
.panel {
  display: grid;
  gap: 16px;
  margin-top: 24px;
  min-width: 0;
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

- [ ] **Step 5: Run the component tests to verify they pass**

Run: `npx vitest run tests/components/SeasonalityView.test.tsx tests/components/SeasonalityPanel.test.tsx`
Expected: PASS, 14 tests (9 view, 5 panel).

- [ ] **Step 6: Add the tab to the stock page**

First list `node_modules/next/dist/docs/` and read the guide on server and client components (a server component rendering a client component with plain serialisable props is the pattern used here).

In `app/stock/[symbol]/page.tsx`, add next to the existing `PerformancePanel` import:

```tsx
import { SeasonalityPanel } from '@/components/SeasonalityPanel'
```

In the `tabs` array passed to `<StockTabs>`, directly after this existing entry:

```tsx
          {
            id: 'andamento',
            label: 'Andamento',
            content: <PerformancePanel history={fullHistory} now={now} />,
          },
```

insert:

```tsx
          {
            id: 'stagionalita',
            label: 'Stagionalità',
            content: <SeasonalityPanel history={fullHistory} now={now} />,
          },
```

- [ ] **Step 7: Verify the whole project**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm test`
Expected: all tests pass — 374 (315 before this plan, 59 added: 30 + 5 + 5 + 5 + 14).

Run: `npx eslint lib/seasonality.ts components/Seasonal*.tsx components/MonthlyReturnsTable.tsx "app/stock/[symbol]/page.tsx"`
Expected: no output.

Run: `npx next build`
Expected: exit code 0; `/stock/[symbol]` is listed as partially prerendered, as before.

- [ ] **Step 8: Check the tab live**

Run `npm run dev` in the background, wait for "Ready", then:

Run: `curl -s http://localhost:3000/stock/NVDA | grep -o "Curva stagionale\|Rendimento medio per mese\|Anno per mese\|Giorno della settimana\|Ciclo presidenziale USA\|Stagionalità" | sort -u`
Expected: all six strings. NVDA has daily data, so `Giorno della settimana` must be there.

Stop the dev server. If the page cannot be fetched this way (port in use, login required), do not work around it: record in the ledger that the live check was not performed and say so in the final message. The layout at phone width (375px) and the look of the charts cannot be checked with `curl`; report them as not verified.

- [ ] **Step 9: Commit**

```bash
git add components/SeasonalityView.tsx components/SeasonalityView.module.css components/SeasonalityPanel.tsx components/SeasonalityPanel.module.css tests/components/SeasonalityView.test.tsx tests/components/SeasonalityPanel.test.tsx "app/stock/[symbol]/page.tsx"
git commit -m "feat: add Stagionalità tab with seasonal curve, month, weekday and election-cycle averages"
```
