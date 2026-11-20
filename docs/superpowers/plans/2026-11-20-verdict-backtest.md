# Verdict Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the stock verdict every day and measure, at 10, 30 and 90 trading days, whether the verdict and each signal predicted the stock's move, in absolute terms and against the S&P 500, with a read-only admin view.

**Architecture:** Two new tables (`VerdictLog`, `VerdictOutcome`). Pure functions decide results (`lib/verdict-backtest.ts`) and aggregate them (`lib/verdict-stats.ts`). A DB-facing module (`lib/verdict-log.ts`) records verdicts and writes matured outcomes, called by a new cron route. The admin page only reads.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 on Postgres, vitest, Yahoo daily bars via `getDailyBars`.

**Spec:** `docs/superpowers/specs/2026-11-20-verdict-backtest-design.md`

## Global Constraints

- Horizons are exactly 10, 30 and 90 trading days. Neutral band is exactly 2% (`NEUTRAL_BAND_PCT = 2`), absolute and relative.
- Start from today: no reconstruction from old `PriceSnapshot` rows.
- Prices come from Yahoo daily bars (`getDailyBars`), benchmark is `^GSPC`. Never from `PriceSnapshot`.
- A stock is recorded once per UTC day (`@@unique([stockId, day])`); an outcome once per verdict and horizon (`@@unique([verdictId, horizon])`). Reruns never duplicate (`createMany` with `skipDuplicates: true`).
- Statistics never mix `rulesVersion` values. `RULES_VERSION` is a constant in `lib/evaluate.ts`, bumped by hand.
- The cron endpoint uses the same `CRON_SECRET` bearer check as `/api/cron/refresh`; it is separate from it.
- The admin view is read-only, tables only, admin-only (`getRealUser` + `isAdminEmail`, else `notFound()`).
- No mention of Claude, Anthropic or AI generation in commit messages or code comments. No `Co-Authored-By` trailer.
- `AGENTS.md`: this is not the Next.js you know. Before writing code that uses a Next API (route handler config, page props, `connection`), read the relevant guide in `node_modules/next/dist/docs/` and copy the pattern of an existing route or page.

## Spec amendments made by this plan

Two points differ from the committed spec because the code that exists already decides them. Task 1 edits the spec to match.

1. Tone value for missing data is `unknown` (the existing `Tone` type in `EvaluationPanel.tsx`), not `none`.
2. `VerdictOutcome` has no `absResult` / `relResult` columns. The result of any signal is derived from the stored returns and that signal's stored tone with `resultOf` (the 2% band). This is what lets the admin table show every signal, not only the overall verdict, from one outcome row. `score` is nullable (null when no signal has data).

## Review Focus

Failure modes the spec implies; each has a test in the owning task.

1. Empty watchlist or empty database: the cron answers 200 with zero counts and does not crash (Task 7).
2. Benchmark bars stale or missing: no outcome is written and it is retried the next day (Task 2 and Task 6).
3. Stock with fewer bars than the horizon (new listing) or a reference bar missing: not matured, no outcome (Task 2).
4. Non-US stock: Asian bars are stamped at midnight UTC and US bars in the afternoon; alignment must use the UTC day (Task 2).
5. A stock with no data at all (all tones unknown) or a version with no rows: the admin table shows "in attesa" and `–`, never `NaN` (Task 3 and Task 8).

---

### Task 1: Move tone logic into `lib/evaluate.ts`

**Files:**
- Modify: `lib/evaluate.ts` (append after `evaluateStock`)
- Modify: `components/EvaluationPanel.tsx:1-83`
- Modify: `tests/components/EvaluationPanel.test.tsx:3`
- Create: `tests/lib/verdict-tones.test.ts`
- Modify: `docs/superpowers/specs/2026-11-20-verdict-backtest-design.md`

**Interfaces:**
- Consumes: `Evaluation`, `NewsImpactSummary` (already in `lib/evaluate.ts`), `FairValuePosition` from `lib/fair-value`.
- Produces (all exported from `lib/evaluate.ts`):
  - `type Tone = 'positive' | 'neutral' | 'negative' | 'unknown'`
  - `toneOf(label: string): Tone`
  - `overallScore(tones: Tone[], position: FairValuePosition | null, newsAdjustment?: number): number | null`
  - `overallTone(tones: Tone[], position: FairValuePosition | null, newsAdjustment?: number): Tone`
  - `fairValueTone(fv: Evaluation['fairValue']): Tone`
  - `newsTone(n: NewsImpactSummary): Tone`
  - `interface VerdictTones { overall: Tone; score: number | null; shortTerm: Tone; mediumTerm: Tone; longTerm: Tone; fairValue: Tone; news: Tone }`
  - `verdictTones(e: Evaluation): VerdictTones`
  - `const RULES_VERSION = 1`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/verdict-tones.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { evaluateStock, fairValueTone, newsTone, overallScore, verdictTones, RULES_VERSION, type EvaluateInput, type Evaluation } from '@/lib/evaluate'

const NOW = new Date('2026-11-20T08:30:00Z')

const strongInput: EvaluateInput = {
  latestSnapshot: {
    price: 95, week52High: 100, week52Low: 50, relativePerf13W: 5, pegRatio: 0.8, roe: 20, debtToEquity: 0.5,
    netMargin: 10, dividendYield: 1, payoutRatio: 20, epsTTM: 5, epsGrowth5Y: 10,
  },
  earliestSnapshot: null,
  fairValue: null,
  recentRecommendations: [{ period: new Date('2026-11-01'), strongBuy: 10, buy: 5, hold: 1, sell: 0, strongSell: 0 }],
  newsAnalyses: [],
  now: NOW,
}

describe('overallScore', () => {
  it('is null when no signal has data', () => {
    expect(overallScore(['unknown', 'unknown', 'unknown'], 'below', 1)).toBeNull()
  })

  it('adds fair value and news to the signal balance', () => {
    expect(overallScore(['positive', 'positive', 'neutral'], 'below', 1)).toBe(4)
    expect(overallScore(['negative', 'neutral', 'unknown'], 'above', -1)).toBe(-3)
  })

  it('ignores an unclear fair value', () => {
    expect(overallScore(['positive', 'neutral', 'neutral'], 'unclear')).toBe(1)
  })
})

describe('fairValueTone', () => {
  const fv = (position: Evaluation['fairValue']['position'], reliable: boolean): Evaluation['fairValue'] => ({ position, reliable, low: 1, high: 2, median: 1.5, note: '' })

  it('maps a reliable position to a tone', () => {
    expect(fairValueTone(fv('below', true))).toBe('positive')
    expect(fairValueTone(fv('above', true))).toBe('negative')
    expect(fairValueTone(fv('inside', true))).toBe('neutral')
  })

  it('is unknown when the estimate is missing or unreliable', () => {
    expect(fairValueTone(fv(null, false))).toBe('unknown')
    expect(fairValueTone(fv('unclear', false))).toBe('unknown')
  })
})

describe('newsTone', () => {
  const news = (counted: number, adjustment: -1 | 0 | 1) => ({ counted, positive: 0, negative: 0, net: 0, adjustment, note: '' })

  it('is unknown when no news was counted', () => {
    expect(newsTone(news(0, 0))).toBe('unknown')
  })

  it('follows the adjustment when news was counted', () => {
    expect(newsTone(news(3, 1))).toBe('positive')
    expect(newsTone(news(3, -1))).toBe('negative')
    expect(newsTone(news(3, 0))).toBe('neutral')
  })
})

describe('verdictTones', () => {
  it('reads every signal and the overall verdict from an evaluation', () => {
    const tones = verdictTones(evaluateStock(strongInput))
    expect(tones).toEqual({ overall: 'positive', score: 3, shortTerm: 'positive', mediumTerm: 'positive', longTerm: 'positive', fairValue: 'unknown', news: 'unknown' })
  })

  it('marks a stock with no data as unknown with a null score', () => {
    const empty: EvaluateInput = {
      ...strongInput,
      latestSnapshot: { ...strongInput.latestSnapshot, week52High: null, week52Low: null, relativePerf13W: null, pegRatio: null, roe: null, debtToEquity: null },
      recentRecommendations: [],
    }
    expect(verdictTones(evaluateStock(empty))).toEqual({ overall: 'unknown', score: null, shortTerm: 'unknown', mediumTerm: 'unknown', longTerm: 'unknown', fairValue: 'unknown', news: 'unknown' })
  })
})

it('exposes the rules version', () => {
  expect(RULES_VERSION).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/verdict-tones.test.ts`
Expected: FAIL (`overallScore`, `fairValueTone`, `newsTone`, `verdictTones`, `RULES_VERSION` are not exported from `@/lib/evaluate`).

- [ ] **Step 3: Write the implementation**

Append to `lib/evaluate.ts` (after `evaluateStock`):

```ts
// Bump by hand whenever the rules of evaluateStock or the tone mapping change: the backtest never mixes versions.
export const RULES_VERSION = 1

export type Tone = 'positive' | 'neutral' | 'negative' | 'unknown'

export function toneOf(label: string): Tone {
  const l = label.toLowerCase()
  if (l.includes('non disponibil') || l.includes('nessun dato')) return 'unknown'
  if (l.includes('negativ') || l.includes('deboli')) return 'negative'
  if (l.includes('positiv') || l.includes('solidi')) return 'positive'
  return 'neutral'
}

// Null when no signal has data.
export function overallScore(tones: Tone[], position: FairValuePosition | null, newsAdjustment = 0): number | null {
  const known = tones.filter((t) => t !== 'unknown')
  if (known.length === 0) return null
  let score = known.reduce((acc, t) => acc + (t === 'positive' ? 1 : t === 'negative' ? -1 : 0), 0)
  // Only a reliable range moves the verdict: "unclear" and a missing fair value count for nothing.
  if (position === 'below') score += 1
  else if (position === 'above') score -= 1
  return score + newsAdjustment
}

export function overallTone(tones: Tone[], position: FairValuePosition | null, newsAdjustment = 0): Tone {
  const score = overallScore(tones, position, newsAdjustment)
  if (score === null) return 'unknown'
  return score >= 2 ? 'positive' : score <= -2 ? 'negative' : 'neutral'
}

export function fairValueTone(fv: Evaluation['fairValue']): Tone {
  if (!fv.reliable) return 'unknown'
  return fv.position === 'below' ? 'positive' : fv.position === 'above' ? 'negative' : fv.position === 'inside' ? 'neutral' : 'unknown'
}

export function newsTone(n: NewsImpactSummary): Tone {
  if (n.counted === 0) return 'unknown'
  return n.adjustment > 0 ? 'positive' : n.adjustment < 0 ? 'negative' : 'neutral'
}

export interface VerdictTones {
  overall: Tone
  score: number | null
  shortTerm: Tone
  mediumTerm: Tone
  longTerm: Tone
  fairValue: Tone
  news: Tone
}

export function verdictTones(e: Evaluation): VerdictTones {
  const shortTerm = toneOf(e.shortTerm.label)
  const mediumTerm = toneOf(e.mediumTerm.label)
  const longTerm = toneOf(e.longTerm.label)
  const tones = [shortTerm, mediumTerm, longTerm]
  return {
    overall: overallTone(tones, e.fairValue.position, e.newsImpact.adjustment),
    score: overallScore(tones, e.fairValue.position, e.newsImpact.adjustment),
    shortTerm,
    mediumTerm,
    longTerm,
    fairValue: fairValueTone(e.fairValue),
    news: newsTone(e.newsImpact),
  }
}
```

In `components/EvaluationPanel.tsx`: delete the local `type Tone`, `toneOf` and `overallTone` (lines 36-53 region), and the now unused `FairValuePosition` import if nothing else uses it. Import them instead:

```ts
import { verdictTones, type Evaluation, type Tone } from '@/lib/evaluate'
```

Then in `buildView` replace the `tones` and `overall` lines:

```ts
  const t = verdictTones(evaluation)
  const tones = [t.shortTerm, t.mediumTerm, t.longTerm]
  const overall = t.overall
  return { signals, tones, overall, verdict: VERDICTS[overall] }
```

`VERDICTS: Record<Tone, ...>` keeps using the imported `Tone`.

In `tests/components/EvaluationPanel.test.tsx` line 3, change the import so `overallTone` comes from the library:

```ts
import { EvaluationPanel } from '@/components/EvaluationPanel'
import { overallTone } from '@/lib/evaluate'
```

In the spec file, replace every `none` tone value with `unknown`, replace "`overall`, `score`: overall tone and its numeric score." with "`overall`, `score`: overall tone and its numeric score (null when no signal has data).", delete the `absResult`, `relResult` bullet from `VerdictOutcome`, and add under "Evaluation": "Per-signal results are derived at read time from the stored returns and the stored tone of that signal, with the 2% band; no result is stored."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/verdict-tones.test.ts tests/components/EvaluationPanel.test.tsx tests/lib/evaluate.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/evaluate.ts components/EvaluationPanel.tsx tests/components/EvaluationPanel.test.tsx tests/lib/verdict-tones.test.ts docs/superpowers/specs/2026-11-20-verdict-backtest-design.md
git commit -m "refactor: move verdict tone logic to lib/evaluate"
```

---

### Task 2: Pure outcome logic (`lib/verdict-backtest.ts`)

**Files:**
- Create: `lib/verdict-backtest.ts`
- Create: `tests/helpers/bars.ts`
- Test: `tests/lib/verdict-backtest.test.ts`

**Interfaces:**
- Consumes: `Bar` from `lib/history`, `Tone` from `lib/evaluate`.
- Produces (from `lib/verdict-backtest.ts`):
  - `HORIZONS = [10, 30, 90] as const`, `type Horizon`
  - `NEUTRAL_BAND_PCT = 2`
  - `type Result = 'win' | 'loss' | 'neutral'`
  - `barDay(t: number): string` (UTC day `YYYY-MM-DD`)
  - `resultOf(tone: Tone, pct: number, band?: number): Result | null`
  - `interface PendingVerdict { refDate: string; refPrice: number }`
  - `interface OutcomeReturns { evalDate: string; stockReturnPct: number; benchReturnPct: number; excessPct: number }`
  - `measureReturns(v: PendingVerdict, horizon: number, stock: Bar[], bench: Bar[]): OutcomeReturns | null`
  - `dueHorizons(refDate: string, done: number[], today: string): Horizon[]`
- Produces (from `tests/helpers/bars.ts`): `weekdayBars(start: string, closes: number[]): Bar[]`

- [ ] **Step 1: Write the test helper and the failing tests**

Create `tests/helpers/bars.ts`:

```ts
import type { Bar } from '@/lib/history'

// Daily bars on weekdays only, one per close, starting on `start` (YYYY-MM-DD, a weekday), stamped at 14:00 UTC like a US session.
export function weekdayBars(start: string, closes: number[]): Bar[] {
  const bars: Bar[] = []
  const d = new Date(`${start}T14:00:00Z`)
  for (const close of closes) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
    bars.push({ t: d.getTime(), high: close, low: close, close, volume: 1000 })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return bars
}
```

Create `tests/lib/verdict-backtest.test.ts`. 2026-11-02 is a Monday, so index 10 of weekday bars is 2026-11-16.

```ts
import { describe, it, expect } from 'vitest'
import { barDay, dueHorizons, measureReturns, resultOf } from '@/lib/verdict-backtest'
import { weekdayBars } from '../helpers/bars'

const rising = (from: number, n: number, step = 1) => Array.from({ length: n }, (_, i) => from + i * step)
// Benchmark closing 1% above its reference after 10 trading days.
const bench = (n: number) => rising(4000, n, 4)

describe('resultOf', () => {
  it('judges a positive verdict by a rise of at least 2%', () => {
    expect(resultOf('positive', 2)).toBe('win')
    expect(resultOf('positive', 1.99)).toBe('neutral')
    expect(resultOf('positive', -1.99)).toBe('neutral')
    expect(resultOf('positive', -2)).toBe('loss')
  })

  it('judges a negative verdict by a fall of at least 2%', () => {
    expect(resultOf('negative', -2)).toBe('win')
    expect(resultOf('negative', 0)).toBe('neutral')
    expect(resultOf('negative', 2)).toBe('loss')
  })

  it('has no result for a neutral verdict or a missing signal', () => {
    expect(resultOf('neutral', 10)).toBeNull()
    expect(resultOf('unknown', 10)).toBeNull()
  })
})

describe('measureReturns', () => {
  const verdict = { refDate: '2026-11-02', refPrice: 100 }

  it('measures stock and benchmark over the horizon and takes the difference', () => {
    const r = measureReturns(verdict, 10, weekdayBars('2026-11-02', rising(100, 12)), weekdayBars('2026-11-02', bench(12)))
    expect(r).not.toBeNull()
    expect(r!.evalDate).toBe('2026-11-16')
    expect(r!.stockReturnPct).toBeCloseTo(10, 6)
    expect(r!.benchReturnPct).toBeCloseTo(1, 6)
    expect(r!.excessPct).toBeCloseTo(9, 6)
  })

  it('counts trading days, so a holiday without a bar pushes the evaluation day out', () => {
    const stock = weekdayBars('2026-11-02', rising(100, 13)).filter((b) => barDay(b.t) !== '2026-11-11')
    const r = measureReturns(verdict, 10, stock, weekdayBars('2026-11-02', bench(13)))
    expect(r!.evalDate).toBe('2026-11-17')
  })

  it('is not matured while the horizon bar does not exist', () => {
    expect(measureReturns(verdict, 10, weekdayBars('2026-11-02', rising(100, 10)), weekdayBars('2026-11-02', bench(12)))).toBeNull()
  })

  it('is not measured when the benchmark has not reached the evaluation day', () => {
    expect(measureReturns(verdict, 10, weekdayBars('2026-11-02', rising(100, 12)), weekdayBars('2026-11-02', bench(6)))).toBeNull()
  })

  it('is not measured when the reference day has no bar or the reference price is not positive', () => {
    const stock = weekdayBars('2026-11-02', rising(100, 12))
    const benchBars = weekdayBars('2026-11-02', bench(12))
    expect(measureReturns({ refDate: '2026-11-01', refPrice: 100 }, 10, stock, benchBars)).toBeNull()
    expect(measureReturns({ refDate: '2026-11-04', refPrice: 100 }, 10, stock, benchBars)).toBeNull()
    expect(measureReturns({ refDate: '2026-11-02', refPrice: 0 }, 10, stock, benchBars)).toBeNull()
  })

  it('aligns by UTC day when the two series are stamped at different hours of the day', () => {
    const tokyo = weekdayBars('2026-11-02', rising(100, 12)).map((b) => ({ ...b, t: Date.parse(`${barDay(b.t)}T00:00:00Z`) }))
    const r = measureReturns(verdict, 10, tokyo, weekdayBars('2026-11-02', bench(12)))
    expect(r!.evalDate).toBe('2026-11-16')
    expect(r!.excessPct).toBeCloseTo(9, 6)
  })

  it('reports a benchmark that rose as much as the stock as no excess, and more as a negative one', () => {
    const r = measureReturns(verdict, 10, weekdayBars('2026-11-02', rising(100, 12)), weekdayBars('2026-11-02', rising(4000, 12, 40)))
    expect(r!.stockReturnPct).toBeCloseTo(10, 6)
    expect(r!.benchReturnPct).toBeCloseTo(10, 6)
    expect(r!.excessPct).toBeCloseTo(0, 6)
    const worse = measureReturns(verdict, 10, weekdayBars('2026-11-02', rising(100, 12)), weekdayBars('2026-11-02', rising(4000, 12, 80)))
    expect(worse!.excessPct).toBeLessThan(0)
  })
})

describe('dueHorizons', () => {
  it('returns the horizons whose minimum calendar span has passed and that are not done', () => {
    expect(dueHorizons('2026-11-02', [], '2026-11-15')).toEqual([])
    expect(dueHorizons('2026-11-02', [], '2026-11-16')).toEqual([10])
    expect(dueHorizons('2026-11-02', [10], '2026-12-14')).toEqual([30])
    expect(dueHorizons('2026-11-02', [], '2027-03-10')).toEqual([10, 30, 90])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/verdict-backtest.test.ts`
Expected: FAIL (`@/lib/verdict-backtest` does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `lib/verdict-backtest.ts`:

```ts
import type { Bar } from './history'
import type { Tone } from './evaluate'

export const HORIZONS = [10, 30, 90] as const
export type Horizon = (typeof HORIZONS)[number]
export const NEUTRAL_BAND_PCT = 2

export type Result = 'win' | 'loss' | 'neutral'

// UTC day of a bar. Yahoo stamps each daily bar at the market's own open, which is the same UTC day on every exchange.
export const barDay = (t: number): string => new Date(t).toISOString().slice(0, 10)

// A positive verdict wins on a rise of at least the band, a negative one on a fall. Neutral and missing signals have no result.
export function resultOf(tone: Tone, pct: number, band = NEUTRAL_BAND_PCT): Result | null {
  if (tone === 'neutral' || tone === 'unknown') return null
  const signed = tone === 'positive' ? pct : -pct
  return signed >= band ? 'win' : signed <= -band ? 'loss' : 'neutral'
}

export interface PendingVerdict {
  refDate: string
  refPrice: number
}

export interface OutcomeReturns {
  evalDate: string
  stockReturnPct: number
  benchReturnPct: number
  excessPct: number
}

// Index of the last bar on or before a day, -1 when the series starts later. Bars are sorted by time.
function lastIndexOnOrBefore(bars: Bar[], day: string): number {
  let found = -1
  for (let i = 0; i < bars.length; i++) {
    if (barDay(bars[i].t) <= day) found = i
    else break
  }
  return found
}

// Returns over `horizon` trading days from the reference bar, or null while it cannot be measured safely (not matured, data missing).
export function measureReturns(v: PendingVerdict, horizon: number, stock: Bar[], bench: Bar[]): OutcomeReturns | null {
  if (v.refPrice <= 0) return null
  const start = lastIndexOnOrBefore(stock, v.refDate)
  // The reference bar itself must exist, otherwise the day count would be off.
  if (start < 0 || barDay(stock[start].t) !== v.refDate) return null
  const end = start + horizon
  if (end >= stock.length) return null
  const evalDate = barDay(stock[end].t)

  const benchStart = lastIndexOnOrBefore(bench, v.refDate)
  const benchEnd = lastIndexOnOrBefore(bench, evalDate)
  if (benchStart < 0 || benchEnd <= benchStart || barDay(bench[bench.length - 1].t) < evalDate) return null

  const stockReturnPct = ((stock[end].close - v.refPrice) / v.refPrice) * 100
  const benchReturnPct = ((bench[benchEnd].close - bench[benchStart].close) / bench[benchStart].close) * 100
  return { evalDate, stockReturnPct, benchReturnPct, excessPct: stockReturnPct - benchReturnPct }
}

const DAY_MS = 86_400_000

// N trading days take at least N × 7/5 calendar days (holidays only lengthen it): below that, do not even download the bars.
export function dueHorizons(refDate: string, done: number[], today: string): Horizon[] {
  return HORIZONS.filter((h) => {
    if (done.includes(h)) return false
    const earliest = new Date(Date.parse(`${refDate}T00:00:00Z`) + Math.ceil((h * 7) / 5) * DAY_MS).toISOString().slice(0, 10)
    return earliest <= today
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/verdict-backtest.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/verdict-backtest.ts tests/helpers/bars.ts tests/lib/verdict-backtest.test.ts
git commit -m "feat: add pure outcome logic for the verdict backtest"
```

---

### Task 3: Pure statistics (`lib/verdict-stats.ts`)

**Files:**
- Create: `lib/verdict-stats.ts`
- Test: `tests/lib/verdict-stats.test.ts`

**Interfaces:**
- Consumes: `Tone` from `lib/evaluate`; `resultOf`, `Result` from `lib/verdict-backtest`.
- Produces:
  - `MIN_SAMPLE = 30`
  - `SIGNALS = ['overall','shortTerm','mediumTerm','longTerm','fairValue','news'] as const`, `type SignalKey`
  - `interface StatRow { horizon: number; tones: Record<SignalKey, Tone>; stockReturnPct: number; excessPct: number }`
  - `interface Counts { win: number; loss: number; neutral: number; rate: number | null }`
  - `interface ToneStats { count: number; avgReturnPct: number | null; avgExcessPct: number | null }`
  - `interface SignalStats { matured: number; abs: Counts; rel: Counts; byTone: Record<'positive' | 'neutral' | 'negative', ToneStats> }`
  - `summarize(rows: StatRow[], key: SignalKey): SignalStats` (caller filters rows by horizon)
  - `toTone(s: string): Tone`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/verdict-stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { summarize, toTone, type StatRow } from '@/lib/verdict-stats'

const tones = (overall: StatRow['tones']['overall']): StatRow['tones'] => ({ overall, shortTerm: overall, mediumTerm: 'unknown', longTerm: 'unknown', fairValue: 'unknown', news: 'unknown' })
const row = (overall: StatRow['tones']['overall'], stockReturnPct: number, excessPct: number): StatRow => ({ horizon: 10, tones: tones(overall), stockReturnPct, excessPct })

describe('summarize', () => {
  it('counts wins, losses and neutrals and rates wins over wins plus losses', () => {
    const s = summarize([row('positive', 3, 3), row('positive', -3, -3), row('positive', 1, 1), row('positive', 5, 5)], 'overall')
    expect(s.matured).toBe(4)
    expect(s.abs).toEqual({ win: 2, loss: 1, neutral: 1, rate: (2 / 3) * 100 })
  })

  it('judges the relative result on the excess return, not on the stock return', () => {
    const s = summarize([row('positive', 5, -3), row('positive', 5, 4)], 'overall')
    expect(s.abs.win).toBe(2)
    expect(s.rel).toEqual({ win: 1, loss: 1, neutral: 0, rate: 50 })
  })

  it('keeps neutral verdicts as a comparison group without results', () => {
    const s = summarize([row('neutral', 2, 1), row('neutral', 4, 3), row('positive', 6, 5)], 'overall')
    expect(s.byTone.neutral).toEqual({ count: 2, avgReturnPct: 3, avgExcessPct: 2 })
    expect(s.abs.win).toBe(1)
    expect(s.matured).toBe(3)
  })

  it('splits the average returns by tone', () => {
    const s = summarize([row('positive', 4, 2), row('positive', 2, 0), row('negative', -2, -1)], 'overall')
    expect(s.byTone.positive).toEqual({ count: 2, avgReturnPct: 3, avgExcessPct: 1 })
    expect(s.byTone.negative).toEqual({ count: 1, avgReturnPct: -2, avgExcessPct: -1 })
  })

  it('leaves out rows where that signal had no data', () => {
    const s = summarize([row('positive', 3, 3)], 'longTerm')
    expect(s.matured).toBe(0)
  })

  it('has no rate and no averages when there are no matured verdicts', () => {
    const s = summarize([], 'overall')
    expect(s.matured).toBe(0)
    expect(s.abs).toEqual({ win: 0, loss: 0, neutral: 0, rate: null })
    expect(s.rel.rate).toBeNull()
    expect(s.byTone.positive).toEqual({ count: 0, avgReturnPct: null, avgExcessPct: null })
  })
})

describe('toTone', () => {
  it('accepts the four tones and treats anything else as unknown', () => {
    expect(toTone('positive')).toBe('positive')
    expect(toTone('negative')).toBe('negative')
    expect(toTone('neutral')).toBe('neutral')
    expect(toTone('unknown')).toBe('unknown')
    expect(toTone('garbage')).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/verdict-stats.test.ts`
Expected: FAIL (`@/lib/verdict-stats` does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `lib/verdict-stats.ts`:

```ts
import type { Tone } from './evaluate'
import { resultOf, type Result } from './verdict-backtest'

// Below this many matured verdicts a success rate says little; the admin view warns.
export const MIN_SAMPLE = 30

export const SIGNALS = ['overall', 'shortTerm', 'mediumTerm', 'longTerm', 'fairValue', 'news'] as const
export type SignalKey = (typeof SIGNALS)[number]

export interface StatRow {
  horizon: number
  tones: Record<SignalKey, Tone>
  stockReturnPct: number
  excessPct: number
}

export interface Counts {
  win: number
  loss: number
  neutral: number
  // Wins over wins plus losses, in percent. Null when there is neither.
  rate: number | null
}

export interface ToneStats {
  count: number
  avgReturnPct: number | null
  avgExcessPct: number | null
}

export interface SignalStats {
  matured: number
  abs: Counts
  rel: Counts
  byTone: Record<'positive' | 'neutral' | 'negative', ToneStats>
}

const TONES: Tone[] = ['positive', 'neutral', 'negative', 'unknown']
export const toTone = (s: string): Tone => TONES.find((t) => t === s) ?? 'unknown'

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length)

function counts(results: Array<Result | null>): Counts {
  const win = results.filter((r) => r === 'win').length
  const loss = results.filter((r) => r === 'loss').length
  const neutral = results.filter((r) => r === 'neutral').length
  return { win, loss, neutral, rate: win + loss === 0 ? null : (win / (win + loss)) * 100 }
}

// Rows are those of one horizon and one rules version: the caller filters them.
export function summarize(rows: StatRow[], key: SignalKey): SignalStats {
  const known = rows.filter((r) => r.tones[key] !== 'unknown')
  const group = (tone: 'positive' | 'neutral' | 'negative'): ToneStats => {
    const g = known.filter((r) => r.tones[key] === tone)
    return { count: g.length, avgReturnPct: mean(g.map((r) => r.stockReturnPct)), avgExcessPct: mean(g.map((r) => r.excessPct)) }
  }
  return {
    matured: known.length,
    abs: counts(known.map((r) => resultOf(r.tones[key], r.stockReturnPct))),
    rel: counts(known.map((r) => resultOf(r.tones[key], r.excessPct))),
    byTone: { positive: group('positive'), neutral: group('neutral'), negative: group('negative') },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/verdict-stats.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/verdict-stats.ts tests/lib/verdict-stats.test.ts
git commit -m "feat: add statistics for the verdict backtest"
```

---

### Task 4: Database tables

**Files:**
- Modify: `prisma/schema.prisma` (add to `Stock`, append two models)
- Create: `prisma/migrations/20261120100000_add_verdict_log/migration.sql`
- Modify: `tests/helpers/db.ts`

**Interfaces:**
- Produces: Prisma models `VerdictLog` and `VerdictOutcome` (fields below), relation `Stock.verdicts`.

- [ ] **Step 1: Edit the schema**

In `model Stock`, add the line `verdicts VerdictLog[]` after `bullBearNote StockBullBearNote?`. Append to `prisma/schema.prisma`:

```prisma
// One row per stock and UTC day: the verdict as the app showed it, normalized to tones, so it can be checked against what the price did later.
model VerdictLog {
  id             String           @id @default(cuid())
  stockId        String
  stock          Stock            @relation(fields: [stockId], references: [id], onDelete: Cascade)
  day            String
  // Last daily bar available when the verdict was logged: returns are measured from it.
  refDate        String
  refPrice       Float
  overall        String
  score          Int?
  shortTerm      String
  shortTermLabel String
  mediumTerm     String
  mediumTermLabel String
  longTerm       String
  longTermLabel  String
  fairValue      String
  fairValueNote  String
  news           String
  newsNote       String
  rulesVersion   Int
  createdAt      DateTime         @default(now())
  outcomes       VerdictOutcome[]

  @@unique([stockId, day])
  @@index([rulesVersion])
}

// Returns of one verdict over one horizon (trading days), written once the horizon has matured and never recomputed.
model VerdictOutcome {
  id             String     @id @default(cuid())
  verdictId      String
  verdict        VerdictLog @relation(fields: [verdictId], references: [id], onDelete: Cascade)
  horizon        Int
  evalDate       String
  stockReturnPct Float
  benchReturnPct Float
  excessPct      Float
  createdAt      DateTime   @default(now())

  @@unique([verdictId, horizon])
}
```

- [ ] **Step 2: Write the migration**

Create `prisma/migrations/20261120100000_add_verdict_log/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "VerdictLog" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "refDate" TEXT NOT NULL,
    "refPrice" DOUBLE PRECISION NOT NULL,
    "overall" TEXT NOT NULL,
    "score" INTEGER,
    "shortTerm" TEXT NOT NULL,
    "shortTermLabel" TEXT NOT NULL,
    "mediumTerm" TEXT NOT NULL,
    "mediumTermLabel" TEXT NOT NULL,
    "longTerm" TEXT NOT NULL,
    "longTermLabel" TEXT NOT NULL,
    "fairValue" TEXT NOT NULL,
    "fairValueNote" TEXT NOT NULL,
    "news" TEXT NOT NULL,
    "newsNote" TEXT NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerdictLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerdictOutcome" (
    "id" TEXT NOT NULL,
    "verdictId" TEXT NOT NULL,
    "horizon" INTEGER NOT NULL,
    "evalDate" TEXT NOT NULL,
    "stockReturnPct" DOUBLE PRECISION NOT NULL,
    "benchReturnPct" DOUBLE PRECISION NOT NULL,
    "excessPct" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerdictOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerdictLog_rulesVersion_idx" ON "VerdictLog"("rulesVersion");

-- CreateIndex
CREATE UNIQUE INDEX "VerdictLog_stockId_day_key" ON "VerdictLog"("stockId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "VerdictOutcome_verdictId_horizon_key" ON "VerdictOutcome"("verdictId", "horizon");

-- AddForeignKey
ALTER TABLE "VerdictLog" ADD CONSTRAINT "VerdictLog_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerdictOutcome" ADD CONSTRAINT "VerdictOutcome_verdictId_fkey" FOREIGN KEY ("verdictId") REFERENCES "VerdictLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Clear the new tables in the test helper**

In `tests/helpers/db.ts`, inside `resetDb()` add before `await prisma.analystRecommendation.deleteMany()`:

```ts
  await prisma.verdictOutcome.deleteMany()
  await prisma.verdictLog.deleteMany()
```

- [ ] **Step 4: Apply the migration to the test database and regenerate the client**

Run:

```bash
DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2- | tr -d '"') npx prisma migrate deploy
npx prisma generate
npx prisma validate
```

Expected: `migrate deploy` applies `20261120100000_add_verdict_log`; `generate` and `validate` succeed. Then `npx tsc --noEmit` must pass.

If `migrate deploy` reports that the schema and migrations drift, run `DATABASE_URL=<test url> npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --shadow-database-url <a scratch database url>` and make the SQL match what it prints. Do not run `migrate deploy` against the production database in this plan.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261120100000_add_verdict_log tests/helpers/db.ts
git commit -m "feat: add verdict log and outcome tables"
```

---

### Task 5: Record verdicts (`lib/verdict-log.ts`, `recordVerdicts`)

**Files:**
- Create: `lib/verdict-log.ts`
- Test: `tests/lib/verdict-log.test.ts`

**Interfaces:**
- Consumes: `evaluateStock`, `verdictTones`, `RULES_VERSION`, `type EvaluateInput` (Task 1); `barDay` (Task 2); `getDailyBars` (`lib/history`); `getMetrics` (`lib/finnhub`); `buildFairValueInput`, `fairValue` (`lib/fair-value`); `weekdayBars` (Task 2 helper); `watch`, `resetDb` (`tests/helpers/db`).
- Produces: `interface RecordResult { recorded: number; skipped: number; failed: number }` and `recordVerdicts(now?: Date): Promise<RecordResult>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/verdict-log.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import * as history from '@/lib/history'
import { recordVerdicts } from '@/lib/verdict-log'
import { RULES_VERSION } from '@/lib/evaluate'
import { resetDb, watch } from '../helpers/db'
import { weekdayBars } from '../helpers/bars'

const NOW = new Date('2026-11-20T08:30:00Z')
// 15 weekday bars from Monday 2026-10-26: the last one is Friday 2026-11-13 and closes at 114.
const BARS = weekdayBars('2026-10-26', Array.from({ length: 15 }, (_, i) => 100 + i))

const METRICS = {
  peRatio: null, week52High: 120, week52Low: 80, pegRatio: 0.8, roe: 20, netMargin: 10, debtToEquity: 0.5, dividendYield: 1,
  payoutRatio: 20, relativePerf13W: 5, epsTTM: 5, epsGrowth5Y: 10,
}

async function snapshot(stockId: string, price = 114) {
  await prisma.priceSnapshot.create({ data: { stockId, price, changePct: 1, week52High: 120, week52Low: 80, relativePerf13W: 5, pegRatio: 0.8, roe: 20, debtToEquity: 0.5 } })
}

describe('recordVerdicts', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
    vi.spyOn(history, 'getDailyBars').mockResolvedValue(BARS)
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({ ...METRICS })
  })

  it('records one verdict per watched stock with tones, labels, reference bar and rules version', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await snapshot(apple.id)

    expect(await recordVerdicts(NOW)).toEqual({ recorded: 1, skipped: 0, failed: 0 })

    const log = await prisma.verdictLog.findFirstOrThrow({ where: { stockId: apple.id } })
    expect(log.day).toBe('2026-11-20')
    expect(log.refDate).toBe('2026-11-13')
    expect(log.refPrice).toBe(114)
    expect(log.rulesVersion).toBe(RULES_VERSION)
    expect(log.shortTerm).toBe('positive')
    expect(log.shortTermLabel).toBe('Positivo')
    expect(log.longTerm).toBe('positive')
    expect(log.mediumTerm).toBe('unknown')
  })

  it('does not duplicate when run again the same day', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await snapshot(apple.id)
    await recordVerdicts(NOW)

    expect(await recordVerdicts(NOW)).toEqual({ recorded: 0, skipped: 0, failed: 0 })
    expect(await prisma.verdictLog.count()).toBe(1)
  })

  it('skips a stock without a snapshot or without bars', async () => {
    await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    expect(await recordVerdicts(NOW)).toEqual({ recorded: 0, skipped: 1, failed: 0 })

    const msft = await watch({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    await snapshot(msft.id)
    vi.spyOn(history, 'getDailyBars').mockResolvedValue([])
    expect(await recordVerdicts(NOW)).toEqual({ recorded: 0, skipped: 2, failed: 0 })
    expect(await prisma.verdictLog.count()).toBe(0)
  })

  it('still records the verdict, with an unknown fair value, when the metrics call fails', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await snapshot(apple.id)
    vi.spyOn(finnhub, 'getMetrics').mockRejectedValue(new Error('Finnhub request failed: 429 /stock/metric'))

    expect(await recordVerdicts(NOW)).toMatchObject({ recorded: 1, failed: 0 })
    expect((await prisma.verdictLog.findFirstOrThrow()).fairValue).toBe('unknown')
  })

  it('ignores stocks nobody watches', async () => {
    const orphan = await prisma.stock.create({ data: { symbol: 'ZZZ', name: 'Nobody', exchange: 'NASDAQ' } })
    await snapshot(orphan.id)
    expect(await recordVerdicts(NOW)).toEqual({ recorded: 0, skipped: 0, failed: 0 })
  })

  it('counts a stock whose processing throws as failed and goes on with the others', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    const msft = await watch({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    await snapshot(apple.id)
    await snapshot(msft.id)
    vi.spyOn(history, 'getDailyBars').mockImplementation(async (symbol: string) => {
      if (symbol === 'AAPL') throw new Error('boom')
      return BARS
    })

    expect(await recordVerdicts(NOW)).toEqual({ recorded: 1, skipped: 0, failed: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/verdict-log.test.ts`
Expected: FAIL (`@/lib/verdict-log` does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `lib/verdict-log.ts`:

```ts
import type { PriceSnapshot } from '@prisma/client'
import { prisma } from './db'
import { getDailyBars } from './history'
import { getMetrics } from './finnhub'
import { buildFairValueInput, fairValue } from './fair-value'
import { evaluateStock, verdictTones, RULES_VERSION, type EvaluateInput } from './evaluate'
import { barDay } from './verdict-backtest'

export interface RecordResult {
  recorded: number
  skipped: number
  failed: number
}

// The same inputs the stock page feeds to evaluateStock, minus "since you follow", which is per user and not part of the verdict.
function evaluateInput(
  latest: PriceSnapshot,
  news: Array<{ publishedAt: Date; analysis: { direction: string; intensity: number; confidence: string } | null }>,
  recs: EvaluateInput['recentRecommendations'],
  metrics: Awaited<ReturnType<typeof getMetrics>> | null,
  now: Date,
): EvaluateInput {
  return {
    fairValue: metrics ? fairValue(buildFairValueInput(latest.price, metrics)) : null,
    latestSnapshot: {
      price: latest.price,
      week52High: latest.week52High,
      week52Low: latest.week52Low,
      relativePerf13W: latest.relativePerf13W,
      pegRatio: latest.pegRatio,
      roe: latest.roe,
      debtToEquity: latest.debtToEquity,
      netMargin: latest.netMargin,
      dividendYield: latest.dividendYield,
      payoutRatio: latest.payoutRatio,
      epsTTM: latest.epsTTM,
      epsGrowth5Y: latest.epsGrowth5Y,
    },
    earliestSnapshot: null,
    newsAnalyses: news.flatMap((n) => (n.analysis ? [{ direction: n.analysis.direction, intensity: n.analysis.intensity, confidence: n.analysis.confidence, publishedAt: n.publishedAt }] : [])),
    recentRecommendations: recs,
    now,
  }
}

// Writes today's verdict for every stock someone watches. Running it twice the same day adds nothing.
export async function recordVerdicts(now = new Date()): Promise<RecordResult> {
  const day = now.toISOString().slice(0, 10)
  const stocks = await prisma.stock.findMany({ where: { watchers: { some: {} } }, select: { id: true, symbol: true } })
  const result: RecordResult = { recorded: 0, skipped: 0, failed: 0 }

  for (const stock of stocks) {
    try {
      const [latest, news, recs, bars, metrics] = await Promise.all([
        prisma.priceSnapshot.findFirst({ where: { stockId: stock.id }, orderBy: { timestamp: 'desc' } }),
        prisma.newsItem.findMany({ where: { stockId: stock.id }, orderBy: { publishedAt: 'desc' }, take: 20, include: { analysis: true } }),
        prisma.analystRecommendation.findMany({ where: { stockId: stock.id }, orderBy: { period: 'desc' }, take: 2 }),
        getDailyBars(stock.symbol),
        getMetrics(stock.symbol).catch(() => null),
      ])
      const last = bars[bars.length - 1]
      if (!latest || !last) {
        result.skipped++
        continue
      }

      const evaluation = evaluateStock(evaluateInput(latest, news, recs, metrics, now))
      const tones = verdictTones(evaluation)
      const created = await prisma.verdictLog.createMany({
        data: [
          {
            stockId: stock.id,
            day,
            refDate: barDay(last.t),
            refPrice: last.close,
            overall: tones.overall,
            score: tones.score,
            shortTerm: tones.shortTerm,
            shortTermLabel: evaluation.shortTerm.label,
            mediumTerm: tones.mediumTerm,
            mediumTermLabel: evaluation.mediumTerm.label,
            longTerm: tones.longTerm,
            longTermLabel: evaluation.longTerm.label,
            fairValue: tones.fairValue,
            fairValueNote: evaluation.fairValue.note,
            news: tones.news,
            newsNote: evaluation.newsImpact.note,
            rulesVersion: RULES_VERSION,
          },
        ],
        skipDuplicates: true,
      })
      result.recorded += created.count
    } catch (err) {
      console.error(`Verdict log failed for ${stock.symbol}:`, err instanceof Error ? err.message : err)
      result.failed++
    }
  }
  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/verdict-log.test.ts && npx tsc --noEmit`
Expected: PASS. If `getMetrics`'s return type does not match what `buildFairValueInput` takes, copy the call exactly as `lib/stock-chat-data.ts:35` does (`fairValue(buildFairValueInput(latest.price, metrics))`) and adjust only the local type annotation.

- [ ] **Step 5: Commit**

```bash
git add lib/verdict-log.ts tests/lib/verdict-log.test.ts
git commit -m "feat: record the daily verdict of every watched stock"
```

---

### Task 6: Evaluate matured verdicts (`evaluateMatureVerdicts`)

**Files:**
- Modify: `lib/verdict-log.ts` (append)
- Modify: `tests/lib/verdict-log.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `dueHorizons`, `measureReturns` (Task 2); `getDailyBars`; `VerdictLog` / `VerdictOutcome` models (Task 4).
- Produces: `interface EvaluateResult { evaluated: number; failed: number }`, `evaluateMatureVerdicts(now?: Date): Promise<EvaluateResult>`, `BENCHMARK = '^GSPC'`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/verdict-log.test.ts` (extend the imports with `evaluateMatureVerdicts`, `BENCHMARK` from `@/lib/verdict-log`):

```ts
describe('evaluateMatureVerdicts', () => {
  // Stock +1 per day from 100 (+10% after 10 days); benchmark +4 per day from 4000 (+1% after 10 days).
  const STOCK_BARS = weekdayBars('2026-11-02', Array.from({ length: 40 }, (_, i) => 100 + i))
  const BENCH_BARS = weekdayBars('2026-11-02', Array.from({ length: 40 }, (_, i) => 4000 + i * 4))

  async function logVerdict(stockId: string, refDate = '2026-11-02', day = '2026-11-02') {
    return prisma.verdictLog.create({
      data: {
        stockId, day, refDate, refPrice: 100, overall: 'positive', score: 3,
        shortTerm: 'positive', shortTermLabel: 'Positivo', mediumTerm: 'unknown', mediumTermLabel: 'Nessun dato disponibile',
        longTerm: 'positive', longTermLabel: 'Fondamentali solidi', fairValue: 'unknown', fairValueNote: '', news: 'unknown', newsNote: '',
        rulesVersion: RULES_VERSION,
      },
    })
  }

  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
    vi.spyOn(history, 'getDailyBars').mockImplementation(async (symbol: string) => (symbol === BENCHMARK ? BENCH_BARS : STOCK_BARS))
  })

  it('writes the 10-day outcome once its horizon has matured and leaves the longer ones pending', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    const log = await logVerdict(apple.id)

    expect(await evaluateMatureVerdicts(new Date('2026-11-20T08:30:00Z'))).toEqual({ evaluated: 1, failed: 0 })

    const outcomes = await prisma.verdictOutcome.findMany({ where: { verdictId: log.id } })
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].horizon).toBe(10)
    expect(outcomes[0].evalDate).toBe('2026-11-16')
    expect(outcomes[0].stockReturnPct).toBeCloseTo(10, 6)
    expect(outcomes[0].excessPct).toBeCloseTo(9, 6)
  })

  it('does not duplicate an outcome when run again', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await logVerdict(apple.id)
    await evaluateMatureVerdicts(new Date('2026-11-20T08:30:00Z'))

    expect(await evaluateMatureVerdicts(new Date('2026-11-21T08:30:00Z'))).toEqual({ evaluated: 0, failed: 0 })
    expect(await prisma.verdictOutcome.count()).toBe(1)
  })

  it('does not download any bars while no horizon can have matured', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await logVerdict(apple.id, '2026-11-16', '2026-11-16')
    const spy = vi.spyOn(history, 'getDailyBars')

    expect(await evaluateMatureVerdicts(new Date('2026-11-20T08:30:00Z'))).toEqual({ evaluated: 0, failed: 0 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('writes nothing and counts a failure when the benchmark bars are missing', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await logVerdict(apple.id)
    vi.spyOn(history, 'getDailyBars').mockImplementation(async (symbol: string) => (symbol === BENCHMARK ? [] : STOCK_BARS))

    expect(await evaluateMatureVerdicts(new Date('2026-11-20T08:30:00Z'))).toEqual({ evaluated: 0, failed: 1 })
    expect(await prisma.verdictOutcome.count()).toBe(0)
  })

  it('writes nothing for a stock whose bars are missing and still evaluates the others', async () => {
    const apple = await watch({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    const msft = await watch({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    await logVerdict(apple.id)
    await logVerdict(msft.id)
    vi.spyOn(history, 'getDailyBars').mockImplementation(async (symbol: string) => (symbol === BENCHMARK ? BENCH_BARS : symbol === 'AAPL' ? [] : STOCK_BARS))

    expect(await evaluateMatureVerdicts(new Date('2026-11-20T08:30:00Z'))).toEqual({ evaluated: 1, failed: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/verdict-log.test.ts`
Expected: FAIL (`evaluateMatureVerdicts` and `BENCHMARK` are not exported).

- [ ] **Step 3: Write minimal implementation**

In `lib/verdict-log.ts` change the import line `import { barDay } from './verdict-backtest'` to `import { barDay, dueHorizons, measureReturns } from './verdict-backtest'`, then append:

```ts
export const BENCHMARK = '^GSPC'

export interface EvaluateResult {
  evaluated: number
  failed: number
}

// Yahoo's daily series covers two years: older verdicts cannot be measured any more.
const LOOKBACK_DAYS = 600

// Writes the outcome of every verdict whose horizon has matured. Failures (no bars, stale benchmark) leave it pending for the next run.
export async function evaluateMatureVerdicts(now = new Date()): Promise<EvaluateResult> {
  const today = now.toISOString().slice(0, 10)
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10)
  const logs = await prisma.verdictLog.findMany({
    where: { refDate: { gte: since } },
    select: { id: true, refDate: true, refPrice: true, stock: { select: { symbol: true } }, outcomes: { select: { horizon: true } } },
  })

  const due = logs.flatMap((log) => dueHorizons(log.refDate, log.outcomes.map((o) => o.horizon), today).map((horizon) => ({ log, horizon })))
  if (due.length === 0) return { evaluated: 0, failed: 0 }

  const bench = await getDailyBars(BENCHMARK)
  if (bench.length === 0) return { evaluated: 0, failed: 1 }

  const symbols = [...new Set(due.map((d) => d.log.stock.symbol))]
  const rows: Array<{ verdictId: string; horizon: number; evalDate: string; stockReturnPct: number; benchReturnPct: number; excessPct: number }> = []
  let failed = 0
  for (const symbol of symbols) {
    let bars
    try {
      bars = await getDailyBars(symbol)
    } catch {
      bars = []
    }
    if (bars.length === 0) {
      failed++
      continue
    }
    for (const { log, horizon } of due.filter((d) => d.log.stock.symbol === symbol)) {
      const r = measureReturns({ refDate: log.refDate, refPrice: log.refPrice }, horizon, bars, bench)
      if (r) rows.push({ verdictId: log.id, horizon, ...r })
    }
  }

  const created = rows.length > 0 ? await prisma.verdictOutcome.createMany({ data: rows, skipDuplicates: true }) : { count: 0 }
  return { evaluated: created.count, failed }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/verdict-log.test.ts && npx tsc --noEmit`
Expected: PASS (both `describe` blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/verdict-log.ts tests/lib/verdict-log.test.ts
git commit -m "feat: evaluate matured verdicts against the S&P 500"
```

---

### Task 7: Cron endpoint and schedule

**Files:**
- Create: `app/api/cron/verdicts/route.ts`
- Modify: `vercel.json`
- Create: `tests/api/verdicts-cron.test.ts`

**Interfaces:**
- Consumes: `recordVerdicts`, `evaluateMatureVerdicts` (Tasks 5 and 6).
- Produces: `GET /api/cron/verdicts` answering `{ recorded: RecordResult | null, evaluated: EvaluateResult | null }`.

- [ ] **Step 1: Read the Next.js guide and copy the pattern**

Run `ls node_modules/next/dist/docs` and open the guide on route handlers and route segment config (`maxDuration`). Open `app/api/cron/discover/route.ts` and `app/api/cron/refresh/route.ts`; this route copies their structure and the `export const maxDuration = 60` used by `cron/discover`.

- [ ] **Step 2: Write the failing tests**

Create `tests/api/verdicts-cron.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as verdictLog from '@/lib/verdict-log'
import { resetDb } from '../helpers/db'
import { GET as cronVerdicts } from '@/app/api/cron/verdicts/route'

const call = (token?: string) => cronVerdicts(new Request('http://localhost', { headers: token ? { authorization: `Bearer ${token}` } : {} }) as any)

describe('cron verdicts route', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('rejects a missing or wrong bearer token', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('wrong')).status).toBe(401)
  })

  it('rejects everything when no secret is configured', async () => {
    delete process.env.CRON_SECRET
    expect((await call('anything')).status).toBe(401)
  })

  it('records, then evaluates, and reports both', async () => {
    vi.spyOn(verdictLog, 'recordVerdicts').mockResolvedValue({ recorded: 2, skipped: 1, failed: 0 })
    vi.spyOn(verdictLog, 'evaluateMatureVerdicts').mockResolvedValue({ evaluated: 3, failed: 0 })

    const res = await call('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ recorded: { recorded: 2, skipped: 1, failed: 0 }, evaluated: { evaluated: 3, failed: 0 } })
  })

  it('still evaluates when recording throws, and reports null for the failed step', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(verdictLog, 'recordVerdicts').mockRejectedValue(new Error('db down'))
    vi.spyOn(verdictLog, 'evaluateMatureVerdicts').mockResolvedValue({ evaluated: 0, failed: 0 })

    const res = await call('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ recorded: null, evaluated: { evaluated: 0, failed: 0 } })
  })

  it('answers with zero counts on an empty database', async () => {
    await resetDb()
    const res = await call('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ recorded: { recorded: 0, skipped: 0, failed: 0 }, evaluated: { evaluated: 0, failed: 0 } })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/api/verdicts-cron.test.ts`
Expected: FAIL (route does not exist).

- [ ] **Step 4: Write the route and the schedule**

Create `app/api/cron/verdicts/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { evaluateMatureVerdicts, recordVerdicts } from '@/lib/verdict-log'

export const maxDuration = 60

// Daily: logs today's verdict of every watched stock, then measures the verdicts whose horizon has matured.
// The two steps are independent: a failure in one does not stop the other.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const recorded = await recordVerdicts().catch((err) => {
    console.error('Recording verdicts failed:', err instanceof Error ? err.message : err)
    return null
  })
  const evaluated = await evaluateMatureVerdicts().catch((err) => {
    console.error('Evaluating verdicts failed:', err instanceof Error ? err.message : err)
    return null
  })

  return NextResponse.json({ recorded, evaluated })
}
```

Replace `vercel.json` with:

```json
{
  "crons": [
    {
      "path": "/api/cron/refresh",
      "schedule": "0 8 * * 1-5"
    },
    {
      "path": "/api/cron/verdicts",
      "schedule": "30 8 * * 1-5"
    }
  ]
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/api/verdicts-cron.test.ts tests/api/auth-coverage.test.ts && npx tsc --noEmit`
Expected: PASS (`cron/` routes are exempt from `requireUser`, so the coverage test accepts the new route).

```bash
git add app/api/cron/verdicts/route.ts vercel.json tests/api/verdicts-cron.test.ts
git commit -m "feat: add the daily verdict backtest cron"
```

---

### Task 8: Admin view

**Files:**
- Create: `app/admin/backtest/page.tsx`
- Create: `app/admin/backtest/backtest.module.css`
- Modify: `components/AdminTabs.tsx:8`

**Interfaces:**
- Consumes: `summarize`, `SIGNALS`, `MIN_SAMPLE`, `toTone`, `StatRow`, `SignalKey`, `SignalStats` (Task 3); `HORIZONS` (Task 2); Prisma models (Task 4); `getRealUser`, `isAdminEmail` (`lib/auth`); `AuthGate`, `SectionSkeleton`.
- Produces: the route `/admin/backtest`.

- [ ] **Step 1: Read the guide and the existing page**

Open the Next.js docs guide on pages and `searchParams` (it is a Promise in this version; `app/admin/page.tsx` shows the exact usage). Copy the `Suspense` + `AuthGate` + inner async component structure of `app/admin/page.tsx`.

- [ ] **Step 2: Add the tab**

In `components/AdminTabs.tsx` replace the `SECTIONS` line with:

```ts
const SECTIONS = [
  { href: '/admin', label: 'Utenti' },
  { href: '/admin/backtest', label: 'Backtest' },
]
```

- [ ] **Step 3: Write the page**

Create `app/admin/backtest/page.tsx`:

```tsx
import { Suspense } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { notFound } from 'next/navigation'
import { SectionSkeleton } from '@/components/SectionSkeleton'
import { AuthGate } from '@/components/AuthGate'
import { getRealUser, isAdminEmail } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { HORIZONS } from '@/lib/verdict-backtest'
import { MIN_SAMPLE, SIGNALS, summarize, toTone, type Counts, type SignalKey, type SignalStats, type StatRow, type ToneStats } from '@/lib/verdict-stats'
import admin from '../admin.module.css'
import styles from './backtest.module.css'

const LABELS: Record<SignalKey, string> = {
  overall: 'Verdetto complessivo',
  shortTerm: 'Breve termine',
  mediumTerm: 'Medio termine',
  longTerm: 'Lungo termine',
  fairValue: 'Valore equo',
  news: 'Notizie',
}

const signed = (n: number | null) => (n === null ? '–' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`)

function ResultCell({ c }: { c: Counts }) {
  if (c.win + c.loss + c.neutral === 0) return <td>–</td>
  return (
    <td>
      {c.win} / {c.loss} / {c.neutral}
      {c.rate !== null && <span className={styles.rate}> · {c.rate.toFixed(0)}%</span>}
    </td>
  )
}

function ToneCell({ t }: { t: ToneStats }) {
  if (t.count === 0) return <td>–</td>
  return (
    <td>
      {t.count} · {signed(t.avgReturnPct)} · {signed(t.avgExcessPct)}
    </td>
  )
}

function HorizonTable({ horizon, rows, recorded }: { horizon: number; rows: StatRow[]; recorded: number }) {
  const stats = new Map<SignalKey, SignalStats>(SIGNALS.map((key) => [key, summarize(rows, key)]))
  return (
    <section className={styles.block}>
      <h3 className={styles.horizon}>{horizon} giorni di borsa</h3>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Segnale</th>
              <th scope="col">Maturi</th>
              <th scope="col" title="vittorie / sconfitte / neutri · tasso di successo">
                Esito assoluto
              </th>
              <th scope="col" title="vittorie / sconfitte / neutri · tasso di successo, misurato sull’eccesso rispetto all’S&P 500">
                Esito vs S&amp;P 500
              </th>
              <th scope="col">Tono positivo</th>
              <th scope="col">Tono neutro</th>
              <th scope="col">Tono negativo</th>
            </tr>
          </thead>
          <tbody>
            {SIGNALS.map((key) => {
              const s = stats.get(key)!
              return (
                <tr key={key}>
                  <th scope="row">{LABELS[key]}</th>
                  {s.matured === 0 ? (
                    <td colSpan={6} className={styles.pending}>
                      in attesa ({recorded === 0 ? 'nessun verdetto registrato' : `${recorded} registrati`})
                    </td>
                  ) : (
                    <>
                      <td>
                        {s.matured} su {recorded}
                        {s.matured < MIN_SAMPLE && <span className={styles.small}> *</span>}
                      </td>
                      <ResultCell c={s.abs} />
                      <ResultCell c={s.rel} />
                      <ToneCell t={s.byTone.positive} />
                      <ToneCell t={s.byTone.neutral} />
                      <ToneCell t={s.byTone.negative} />
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

async function Backtest({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  await connection()
  const real = await getRealUser()
  if (!real || !isAdminEmail(real.email)) notFound()

  const versions = await prisma.verdictLog.groupBy({ by: ['rulesVersion'], orderBy: { rulesVersion: 'desc' } })
  if (versions.length === 0) {
    return (
      <section>
        <h2 className={admin.heading}>Backtest dei verdetti</h2>
        <p className={admin.lead}>Nessun verdetto registrato ancora. Il primo viene salvato dal job giornaliero; i primi esiti arrivano dopo 10 giorni di borsa.</p>
      </section>
    )
  }

  const { v } = await searchParams
  const version = versions.find((x) => String(x.rulesVersion) === v)?.rulesVersion ?? versions[0].rulesVersion
  const [recorded, outcomes] = await Promise.all([
    prisma.verdictLog.count({ where: { rulesVersion: version } }),
    prisma.verdictOutcome.findMany({ where: { verdict: { rulesVersion: version } }, include: { verdict: true } }),
  ])
  const rows: StatRow[] = outcomes.map((o) => ({
    horizon: o.horizon,
    stockReturnPct: o.stockReturnPct,
    excessPct: o.excessPct,
    tones: {
      overall: toTone(o.verdict.overall),
      shortTerm: toTone(o.verdict.shortTerm),
      mediumTerm: toTone(o.verdict.mediumTerm),
      longTerm: toTone(o.verdict.longTerm),
      fairValue: toTone(o.verdict.fairValue),
      news: toTone(o.verdict.news),
    },
  }))

  return (
    <section>
      <div className={admin.sectionHead}>
        <h2 className={admin.heading}>Backtest dei verdetti</h2>
        <span className={admin.count}>{recorded === 1 ? '1 verdetto' : `${recorded} verdetti`}</span>
      </div>
      <p className={admin.lead}>
        Quanto hanno previsto bene il verdetto e i singoli segnali. Un verdetto positivo vince se il titolo sale di almeno il 2%, uno negativo se scende di almeno il 2%; sotto il 2% l’esito è neutro. Ogni cella mostra vittorie / sconfitte / neutri e il tasso di successo, anche contro l’S&amp;P 500. Nei toni: numero di verdetti · rendimento medio · eccesso medio sull’S&amp;P 500.
      </p>
      {versions.length > 1 && (
        <nav className={styles.versions} aria-label="Versione delle regole">
          {versions.map((x) => (
            <Link key={x.rulesVersion} href={`/admin/backtest?v=${x.rulesVersion}`} aria-current={x.rulesVersion === version ? 'page' : undefined}>
              Regole v{x.rulesVersion}
            </Link>
          ))}
        </nav>
      )}
      {HORIZONS.map((h) => (
        <HorizonTable key={h} horizon={h} rows={rows.filter((r) => r.horizon === h)} recorded={recorded} />
      ))}
      <p className={styles.footnote}>* Meno di {MIN_SAMPLE} verdetti maturi: il tasso di successo è poco significativo.</p>
    </section>
  )
}

export default function BacktestPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  return (
    <Suspense fallback={<SectionSkeleton label="Carico il backtest…" variant="list" rows={4} />}>
      <AuthGate path="/admin/backtest">
        <Backtest searchParams={searchParams} />
      </AuthGate>
    </Suspense>
  )
}
```

Create `app/admin/backtest/backtest.module.css`:

```css
.block {
  margin-top: 24px;
}

.horizon {
  margin-bottom: 8px;
  font-size: 16px;
  font-weight: 600;
}

.scroll {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.table th,
.table td {
  padding: 8px 10px;
  text-align: right;
  border-bottom: 1px solid var(--rule);
}

.table thead th {
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
}

.table th:first-child {
  text-align: left;
}

.pending {
  color: var(--muted);
  text-align: left;
}

.rate {
  color: var(--muted);
}

.small {
  color: var(--muted);
}

.versions {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}

.versions a {
  padding: 4px 10px;
  border: 1px solid var(--rule);
  border-radius: 999px;
  color: var(--muted);
  font-size: 13px;
}

.versions a[aria-current='page'] {
  color: inherit;
  border-color: currentColor;
}

.footnote {
  margin-top: 16px;
  color: var(--muted);
  font-size: 13px;
}
```

If `admin.heading`, `admin.lead`, `admin.sectionHead`, `admin.count` do not all exist in `app/admin/admin.module.css`, they are the ones `app/admin/page.tsx` uses: check with `grep -n "^\.\(heading\|lead\|sectionHead\|count\)" app/admin/admin.module.css` and use the exact names that exist.

- [ ] **Step 4: Verify the build and the page**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Then start the dev server (`npm run dev`), sign in as the admin account, open `/admin/backtest` and check: with no verdicts it shows the empty message; after `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/verdicts` it shows the recorded count and every row "in attesa"; the "Backtest" tab is highlighted; there is no `NaN` anywhere. A non-admin account gets the 404 page.

- [ ] **Step 5: Commit**

```bash
git add app/admin/backtest components/AdminTabs.tsx
git commit -m "feat: add the verdict backtest admin view"
```

---

### Task 9: Final verification

**Files:** none (verification only; fix what it finds in the file that owns the failure).

- [ ] **Step 1: Run the whole suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all green. `tests/api/auth-coverage.test.ts` must still pass, and the existing `EvaluationPanel` tests must pass unchanged apart from the import line edited in Task 1.

- [ ] **Step 2: Check the spec against the result**

Open `docs/superpowers/specs/2026-11-20-verdict-backtest-design.md` and confirm each section has its code: data model (Task 4), recording and cron (Tasks 5, 7), evaluation (Tasks 2, 6), admin view (Tasks 3, 8), tests (all). Confirm `git status` shows no leftover changes and the spec edit from Task 1 is committed.

- [ ] **Step 3: Deployment note for the owner (no action in this plan)**

The new migration must be applied to production with `npx prisma migrate deploy` before the first cron run. The first usable numbers appear 10 trading days after the first recorded verdict; the 30 and 90 day columns fill in later.
