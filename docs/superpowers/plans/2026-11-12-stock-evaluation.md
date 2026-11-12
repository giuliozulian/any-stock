# Stock Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty "Considerations" placeholder on the stock
detail page with a real evaluation panel: five rule-based signals
(since-watching return, short/medium/long-term, target-price estimate)
built from data already in Finnhub's free tier, with every number
backed by a named formula or real third-party data — never an invented
prediction.

**Architecture:** One new Prisma model (`AnalystRecommendation`) and
nine new nullable fields on `PriceSnapshot`, populated by one new
Finnhub call (`getRecommendationTrend`) and nine more fields read from
the metrics call already made every refresh. A pure, side-effect-free
module (`lib/evaluate.ts`) turns stored data into the five signals. A
presentational component (`EvaluationPanel`) renders them in the
existing ledger visual language.

**Tech Stack:** Next.js 16 App Router, Prisma 7 + `@prisma/adapter-pg`,
Finnhub REST API, Vitest + React Testing Library — all already in use,
no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-12-stock-evaluation-design.md`

## Global Constraints

- No paid Finnhub tier. `/stock/price-target` is not used (confirmed
  live: returns `{"error":"You don't have access to this resource."}`
  on the free key already configured for this app).
- No invented predictions. Every signal is either derived from stored
  data, real analyst consensus data, or a named, transparent formula
  explicitly labeled as an estimate.
- UI stays a single quiet section on the stock detail page: five
  headline rows (label + value + one-sentence Italian note), raw
  numbers behind a native `<details>` disclosure. No new visual
  language — reuse the existing CSS custom properties (`--rule`,
  `--muted`, `--font-display`, `--brass`, `--brass-dim`, `--gain`,
  `--loss`) already defined in `app/globals.css`.
- `evaluateStock` (`lib/evaluate.ts`) makes no network or database
  calls — pure function, all inputs passed in.

## Review Focus

- A freshly-added stock (one snapshot, no recommendations yet) must
  render every row with a plain "not available" note — never crash,
  never show a misleading `0%` or `$0` target price. (Task 4, Task 5)
- A company with negative or null EPS growth, or negative/zero
  trailing EPS, must never show a fabricated target price. (Task 4)
- A company with no analyst coverage at all must show "Nessun dato
  disponibile", not a false "Consenso misto". (Task 4)
- The since-watching percentage must use the *earliest* stored
  snapshot, not assume query result ordering — the detail page fetches
  it with its own explicit `orderBy: { timestamp: 'asc' }` query,
  decoupled from the chart's capped, descending-order query. (Task 6)
- The new recommendation-trend Finnhub call must not break the
  existing per-symbol failure isolation: one symbol's
  recommendation-fetch failure must not prevent that same symbol's
  price snapshot from being written, and must not stop
  `refreshAllStocks` from refreshing the other symbols. (Task 3)

---

## File Structure

```
any-stock/
├── prisma/
│   └── schema.prisma                        # + AnalystRecommendation model, + PriceSnapshot fields
├── lib/
│   ├── finnhub.ts                           # + getRecommendationTrend, extended FinnhubMetrics
│   ├── refresh.ts                           # + isolated recommendation upsert, + new snapshot fields
│   └── evaluate.ts                          # NEW — pure evaluation logic
├── components/
│   ├── EvaluationPanel.tsx                  # NEW
│   └── EvaluationPanel.module.css           # NEW
├── app/stock/[symbol]/
│   └── page.tsx                             # wire evaluateStock + EvaluationPanel in, drop old placeholder
└── tests/
    ├── helpers/db.ts                        # + analystRecommendation.deleteMany()
    ├── lib/
    │   ├── finnhub.test.ts                  # + getRecommendationTrend, extended getMetrics test
    │   ├── refresh.test.ts                  # + new fields, + recommendation upsert/dedup/isolation
    │   └── evaluate.test.ts                 # NEW
    └── components/
        └── EvaluationPanel.test.tsx         # NEW
```

---

### Task 1: Schema changes

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `tests/helpers/db.ts`
- Test: `tests/helpers/db.test.ts`

**Interfaces:**
- Produces: nine new nullable `Float` fields on `PriceSnapshot`
  (`pegRatio`, `roe`, `netMargin`, `debtToEquity`, `dividendYield`,
  `payoutRatio`, `relativePerf13W`, `epsTTM`, `epsGrowth5Y`); new
  model `AnalystRecommendation` with composite unique key
  `stockId_period` (Prisma's default name for
  `@@unique([stockId, period])`); `Stock.recommendations` relation.

- [ ] **Step 1: Extend the Prisma schema**

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model Stock {
  id              String                  @id @default(cuid())
  symbol          String                  @unique
  name            String
  exchange        String
  addedAt         DateTime                @default(now())
  snapshots       PriceSnapshot[]
  news            NewsItem[]
  recommendations AnalystRecommendation[]
}

model PriceSnapshot {
  id              String   @id @default(cuid())
  stockId         String
  stock           Stock    @relation(fields: [stockId], references: [id], onDelete: Cascade)
  price           Float
  changePct       Float
  volume          BigInt?
  marketCap       Float?
  peRatio         Float?
  week52High      Float?
  week52Low       Float?
  pegRatio        Float?
  roe             Float?
  netMargin       Float?
  debtToEquity    Float?
  dividendYield   Float?
  payoutRatio     Float?
  relativePerf13W Float?
  epsTTM          Float?
  epsGrowth5Y     Float?
  timestamp       DateTime @default(now())

  @@index([stockId, timestamp])
}

model NewsItem {
  id          String   @id @default(cuid())
  stockId     String
  stock       Stock    @relation(fields: [stockId], references: [id], onDelete: Cascade)
  headline    String
  url         String   @unique
  source      String
  summary     String?
  publishedAt DateTime

  @@index([stockId, publishedAt])
}

model AnalystRecommendation {
  id         String   @id @default(cuid())
  stockId    String
  stock      Stock    @relation(fields: [stockId], references: [id], onDelete: Cascade)
  period     DateTime
  strongBuy  Int
  buy        Int
  hold       Int
  sell       Int
  strongSell Int
  fetchedAt  DateTime @default(now())

  @@unique([stockId, period])
  @@index([stockId, period])
}
```

- [ ] **Step 2: Add the cascade-delete check to `resetDb()`**

```typescript
// tests/helpers/db.ts
import { prisma } from '@/lib/db'

export async function resetDb(): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('test')) {
    throw new Error(
      `resetDb() refused: DATABASE_URL does not look like a test database (${url || '(empty)'})`
    )
  }

  await prisma.analystRecommendation.deleteMany()
  await prisma.newsItem.deleteMany()
  await prisma.priceSnapshot.deleteMany()
  await prisma.stock.deleteMany()
}
```

- [ ] **Step 3: Write the failing test**

```typescript
// tests/helpers/db.test.ts — add this test inside the existing `describe('database setup', ...)` block
  it('cascades AnalystRecommendation deletes when a stock is removed', async () => {
    const stock = await prisma.stock.create({
      data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' },
    })

    await prisma.analystRecommendation.create({
      data: {
        stockId: stock.id,
        period: new Date('2026-11-01'),
        strongBuy: 10,
        buy: 20,
        hold: 5,
        sell: 1,
        strongSell: 0,
      },
    })

    await prisma.stock.delete({ where: { symbol: 'MSFT' } })

    const orphans = await prisma.analystRecommendation.findMany({ where: { stockId: stock.id } })
    expect(orphans).toHaveLength(0)
  })
```

- [ ] **Step 4: Run the migration and the test**

Run:
```bash
npx prisma migrate dev --name add_evaluation_fields
npm test -- tests/helpers/db.test.ts
```
Expected: migration creates the new columns and the
`AnalystRecommendation` table; all tests in the file pass, including
the new cascade test.

- [ ] **Step 5: Commit**

```bash
git add prisma/ tests/helpers/db.ts tests/helpers/db.test.ts
git commit -m "feat: add evaluation fields and AnalystRecommendation model"
```

---

### Task 2: Finnhub client additions

**Files:**
- Modify: `lib/finnhub.ts`
- Test: `tests/lib/finnhub.test.ts`

**Interfaces:**
- Produces: `FinnhubMetrics` gains nine new `number | null` fields
  (`pegRatio`, `roe`, `netMargin`, `debtToEquity`, `dividendYield`,
  `payoutRatio`, `relativePerf13W`, `epsTTM`, `epsGrowth5Y`);
  `FinnhubRecommendation { period: string; strongBuy: number; buy:
  number; hold: number; sell: number; strongSell: number }`;
  `getRecommendationTrend(symbol: string): Promise<FinnhubRecommendation[]>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/finnhub.test.ts — replace the existing "getMetrics falls back to null for missing fields" test with this, and add the getRecommendationTrend test at the end of the `describe('finnhub client', ...)` block

  it('getMetrics falls back to null for missing fields', async () => {
    mockFetchOnce({ metric: {} })
    const metrics = await getMetrics('AAPL')
    expect(metrics).toEqual({
      peRatio: null,
      week52High: null,
      week52Low: null,
      pegRatio: null,
      roe: null,
      netMargin: null,
      debtToEquity: null,
      dividendYield: null,
      payoutRatio: null,
      relativePerf13W: null,
      epsTTM: null,
      epsGrowth5Y: null,
    })
  })

  it('getMetrics maps fundamental and momentum fields when present', async () => {
    mockFetchOnce({
      metric: {
        pegTTM: 1.4,
        roeTTM: 22.5,
        netProfitMarginTTM: 18.2,
        'totalDebt/totalEquityAnnual': 0.8,
        currentDividendYieldTTM: 0.5,
        payoutRatioTTM: 15,
        'priceRelativeToS&P50013Week': 3.1,
        epsTTM: 6.4,
        epsGrowth5Y: 12.5,
      },
    })
    const metrics = await getMetrics('AAPL')
    expect(metrics).toMatchObject({
      pegRatio: 1.4,
      roe: 22.5,
      netMargin: 18.2,
      debtToEquity: 0.8,
      dividendYield: 0.5,
      payoutRatio: 15,
      relativePerf13W: 3.1,
      epsTTM: 6.4,
      epsGrowth5Y: 12.5,
    })
  })

  it('getRecommendationTrend maps analyst recommendation periods', async () => {
    mockFetchOnce([
      { symbol: 'AAPL', period: '2026-11-01', strongBuy: 11, buy: 19, hold: 15, sell: 3, strongSell: 1 },
      { symbol: 'AAPL', period: '2026-10-01', strongBuy: 11, buy: 20, hold: 14, sell: 3, strongSell: 1 },
    ])
    const trend = await getRecommendationTrend('AAPL')
    expect(trend).toEqual([
      { period: '2026-11-01', strongBuy: 11, buy: 19, hold: 15, sell: 3, strongSell: 1 },
      { period: '2026-10-01', strongBuy: 11, buy: 20, hold: 14, sell: 3, strongSell: 1 },
    ])
  })
```

Also update the test file's import line to include the new function:

```typescript
import { searchSymbol, getQuote, getProfile, getMetrics, getCompanyNews, getRecommendationTrend } from '@/lib/finnhub'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/finnhub.test.ts`
Expected: FAIL — `getMetrics falls back to null` fails on the extra
expected fields (not yet returned); `getRecommendationTrend` fails
with "getRecommendationTrend is not a function" or a TypeScript error
on the import.

- [ ] **Step 3: Extend `FinnhubMetrics` and `getMetrics`, add `getRecommendationTrend`**

```typescript
// lib/finnhub.ts — replace the existing FinnhubMetrics interface and getMetrics function with:

export interface FinnhubMetrics {
  peRatio: number | null
  week52High: number | null
  week52Low: number | null
  pegRatio: number | null
  roe: number | null
  netMargin: number | null
  debtToEquity: number | null
  dividendYield: number | null
  payoutRatio: number | null
  relativePerf13W: number | null
  epsTTM: number | null
  epsGrowth5Y: number | null
}

export interface FinnhubRecommendation {
  period: string
  strongBuy: number
  buy: number
  hold: number
  sell: number
  strongSell: number
}

// ... (searchSymbol, getQuote, getProfile stay unchanged) ...

export async function getMetrics(symbol: string): Promise<FinnhubMetrics> {
  const data = await finnhubFetch<{ metric: Record<string, number | undefined> }>('/stock/metric', {
    symbol,
    metric: 'all',
  })
  return {
    peRatio: data.metric.peBasicExclExtraTTM ?? null,
    week52High: data.metric['52WeekHigh'] ?? null,
    week52Low: data.metric['52WeekLow'] ?? null,
    pegRatio: data.metric.pegTTM ?? null,
    roe: data.metric.roeTTM ?? null,
    netMargin: data.metric.netProfitMarginTTM ?? null,
    debtToEquity: data.metric['totalDebt/totalEquityAnnual'] ?? null,
    dividendYield: data.metric.currentDividendYieldTTM ?? null,
    payoutRatio: data.metric.payoutRatioTTM ?? null,
    relativePerf13W: data.metric['priceRelativeToS&P50013Week'] ?? null,
    epsTTM: data.metric.epsTTM ?? null,
    epsGrowth5Y: data.metric.epsGrowth5Y ?? null,
  }
}

export async function getRecommendationTrend(symbol: string): Promise<FinnhubRecommendation[]> {
  const data = await finnhubFetch<
    Array<{ symbol: string; period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }>
  >('/stock/recommendation', { symbol })
  return data.map((d) => ({
    period: d.period,
    strongBuy: d.strongBuy,
    buy: d.buy,
    hold: d.hold,
    sell: d.sell,
    strongSell: d.strongSell,
  }))
}

// ... (getCompanyNews stays unchanged) ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/finnhub.test.ts`
Expected: PASS (9 tests — the original 7, minus the one replaced, plus
2 new ones: net +2).

- [ ] **Step 5: Commit**

```bash
git add lib/finnhub.ts tests/lib/finnhub.test.ts
git commit -m "feat: add Finnhub recommendation trend and extended metrics"
```

---

### Task 3: Refresh logic changes

**Files:**
- Modify: `lib/refresh.ts`
- Test: `tests/lib/refresh.test.ts`

**Interfaces:**
- Consumes: `getRecommendationTrend` from `@/lib/finnhub` (Task 2),
  `prisma.analystRecommendation` (Task 1).
- Produces: `refreshStock` now also writes the nine new
  `PriceSnapshot` fields and upserts `AnalystRecommendation` rows; its
  public signature (`Promise<RefreshResult>`) is unchanged.

**Note on scope:** the existing news-fetch step was not isolated from
the price-snapshot write either (a `getCompanyNews` failure already
made the whole refresh report `ok: false` even though the snapshot had
already been saved). This task fixes that inconsistency at the same
time as isolating the new recommendation fetch, using the same
try/catch pattern for both — leaving one isolated and the other not
would be an inconsistent result for no reason.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/refresh.test.ts — full replacement of the file's contents
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import { resetDb } from '../helpers/db'
import { refreshStock, refreshAllStocks } from '@/lib/refresh'

const BASE_METRICS = {
  peRatio: null,
  week52High: null,
  week52Low: null,
  pegRatio: null,
  roe: null,
  netMargin: null,
  debtToEquity: null,
  dividendYield: null,
  payoutRatio: null,
  relativePerf13W: null,
  epsTTM: null,
  epsGrowth5Y: null,
}

describe('refreshStock', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('writes a price snapshot, news items, and recommendation rows for a known stock', async () => {
    const stock = await prisma.stock.create({
      data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
    })

    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 150, changePercent: 1.1, high: 151, low: 149, open: 149.5, previousClose: 148.9,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 3000000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({
      ...BASE_METRICS,
      peRatio: 28.5,
      week52High: 180,
      week52Low: 120,
      pegRatio: 1.4,
      roe: 22.5,
      debtToEquity: 0.8,
      epsTTM: 6.4,
      epsGrowth5Y: 12.5,
    })
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([
      { headline: 'Apple news', url: 'https://example.com/n1', source: 'Reuters', summary: 's', datetime: 1700000000 },
    ])
    vi.spyOn(finnhub, 'getRecommendationTrend').mockResolvedValue([
      { period: '2026-11-01', strongBuy: 11, buy: 19, hold: 15, sell: 3, strongSell: 1 },
    ])

    const result = await refreshStock('AAPL')
    expect(result).toEqual({ symbol: 'AAPL', ok: true })

    const snapshots = await prisma.priceSnapshot.findMany({ where: { stockId: stock.id } })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].pegRatio).toBe(1.4)
    expect(snapshots[0].roe).toBe(22.5)
    expect(snapshots[0].epsGrowth5Y).toBe(12.5)

    const news = await prisma.newsItem.findMany({ where: { stockId: stock.id } })
    expect(news).toHaveLength(1)

    const recs = await prisma.analystRecommendation.findMany({ where: { stockId: stock.id } })
    expect(recs).toHaveLength(1)
    expect(recs[0].strongBuy).toBe(11)
    expect(recs[0].period).toEqual(new Date('2026-11-01'))
  })

  it('returns ok:false and does not throw when Finnhub fails', async () => {
    await prisma.stock.create({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockRejectedValue(new Error('Finnhub request failed: 429 /quote'))

    const result = await refreshStock('MSFT')
    expect(result).toEqual({ symbol: 'MSFT', ok: false, error: 'Finnhub request failed: 429 /quote' })
  })

  it('logs the failure so it is visible in server logs, per the spec', async () => {
    await prisma.stock.create({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockRejectedValue(new Error('Finnhub request failed: 429 /quote'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await refreshStock('MSFT')

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('MSFT'), expect.anything())
  })

  it('does not duplicate news items with the same url on repeated refresh', async () => {
    await prisma.stock.create({ data: { symbol: 'TSLA', name: 'Tesla', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 200, changePercent: 0.5, high: 201, low: 199, open: 199, previousClose: 199,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Tesla', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 600000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(BASE_METRICS)
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([
      { headline: 'Tesla news', url: 'https://example.com/t1', source: 'Reuters', summary: 's', datetime: 1700000000 },
    ])
    vi.spyOn(finnhub, 'getRecommendationTrend').mockResolvedValue([])

    await refreshStock('TSLA')
    await refreshStock('TSLA')

    const news = await prisma.newsItem.findMany({ where: { headline: 'Tesla news' } })
    expect(news).toHaveLength(1)
  })

  it('updates rather than duplicates a recommendation row for the same period on repeated refresh', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'TSLA', name: 'Tesla', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 200, changePercent: 0.5, high: 201, low: 199, open: 199, previousClose: 199,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Tesla', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 600000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(BASE_METRICS)
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([])
    vi.spyOn(finnhub, 'getRecommendationTrend')
      .mockResolvedValueOnce([{ period: '2026-11-01', strongBuy: 5, buy: 5, hold: 5, sell: 5, strongSell: 5 }])
      .mockResolvedValueOnce([{ period: '2026-11-01', strongBuy: 20, buy: 5, hold: 2, sell: 0, strongSell: 0 }])

    await refreshStock('TSLA')
    await refreshStock('TSLA')

    const recs = await prisma.analystRecommendation.findMany({ where: { stockId: stock.id } })
    expect(recs).toHaveLength(1)
    expect(recs[0].strongBuy).toBe(20)
  })

  it('still writes the price snapshot when the recommendation-trend fetch fails', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 150, changePercent: 1.1, high: 151, low: 149, open: 149.5, previousClose: 148.9,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 3000000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(BASE_METRICS)
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([])
    vi.spyOn(finnhub, 'getRecommendationTrend').mockRejectedValue(new Error('Finnhub request failed: 500 /stock/recommendation'))

    const result = await refreshStock('AAPL')
    expect(result).toEqual({ symbol: 'AAPL', ok: true })

    const snapshots = await prisma.priceSnapshot.findMany({ where: { stockId: stock.id } })
    expect(snapshots).toHaveLength(1)
    const recs = await prisma.analystRecommendation.findMany({ where: { stockId: stock.id } })
    expect(recs).toHaveLength(0)
  })
})

describe('refreshAllStocks', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('isolates one failing symbol from the rest', async () => {
    await prisma.stock.create({ data: { symbol: 'GOOD', name: 'Good Co', exchange: 'NASDAQ' } })
    await prisma.stock.create({ data: { symbol: 'BAD', name: 'Bad Co', exchange: 'NASDAQ' } })

    vi.spyOn(finnhub, 'getQuote').mockImplementation(async (symbol: string) => {
      if (symbol === 'BAD') throw new Error('Finnhub request failed: 429 /quote')
      return { currentPrice: 10, changePercent: 0, high: 10, low: 10, open: 10, previousClose: 10 }
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Good Co', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 1,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(BASE_METRICS)
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([])
    vi.spyOn(finnhub, 'getRecommendationTrend').mockResolvedValue([])

    const results = await refreshAllStocks()
    expect(results).toHaveLength(2)
    expect(results.find((r) => r.symbol === 'GOOD')?.ok).toBe(true)
    expect(results.find((r) => r.symbol === 'BAD')?.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/refresh.test.ts`
Expected: FAIL — the new snapshot fields aren't written, no
`AnalystRecommendation` rows are created, and `getRecommendationTrend`
is never called.

- [ ] **Step 3: Rewrite `refreshStock`**

```typescript
// lib/refresh.ts
import { prisma } from './db'
import { getQuote, getProfile, getMetrics, getCompanyNews, getRecommendationTrend } from './finnhub'

export interface RefreshResult {
  symbol: string
  ok: boolean
  error?: string
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function logFailure(context: string, symbol: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`${context} failed for ${symbol}:`, message)
}

export async function refreshStock(symbol: string): Promise<RefreshResult> {
  try {
    const stock = await prisma.stock.findUniqueOrThrow({ where: { symbol } })

    const [quote, profile, metrics] = await Promise.all([
      getQuote(symbol),
      getProfile(symbol),
      getMetrics(symbol),
    ])

    await prisma.priceSnapshot.create({
      data: {
        stockId: stock.id,
        price: quote.currentPrice,
        changePct: quote.changePercent,
        marketCap: profile.marketCapitalization,
        peRatio: metrics.peRatio,
        week52High: metrics.week52High,
        week52Low: metrics.week52Low,
        pegRatio: metrics.pegRatio,
        roe: metrics.roe,
        netMargin: metrics.netMargin,
        debtToEquity: metrics.debtToEquity,
        dividendYield: metrics.dividendYield,
        payoutRatio: metrics.payoutRatio,
        relativePerf13W: metrics.relativePerf13W,
        epsTTM: metrics.epsTTM,
        epsGrowth5Y: metrics.epsGrowth5Y,
      },
    })

    try {
      const to = new Date()
      const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
      const news = await getCompanyNews(symbol, toDateString(from), toDateString(to))

      for (const item of news.slice(0, 10)) {
        await prisma.newsItem.upsert({
          where: { url: item.url },
          create: {
            stockId: stock.id,
            headline: item.headline,
            url: item.url,
            source: item.source,
            summary: item.summary,
            publishedAt: new Date(item.datetime * 1000),
          },
          update: {},
        })
      }
    } catch (err) {
      logFailure('News refresh', symbol, err)
    }

    try {
      const recommendations = await getRecommendationTrend(symbol)

      for (const rec of recommendations) {
        await prisma.analystRecommendation.upsert({
          where: { stockId_period: { stockId: stock.id, period: new Date(rec.period) } },
          create: {
            stockId: stock.id,
            period: new Date(rec.period),
            strongBuy: rec.strongBuy,
            buy: rec.buy,
            hold: rec.hold,
            sell: rec.sell,
            strongSell: rec.strongSell,
          },
          update: {
            strongBuy: rec.strongBuy,
            buy: rec.buy,
            hold: rec.hold,
            sell: rec.sell,
            strongSell: rec.strongSell,
          },
        })
      }
    } catch (err) {
      logFailure('Recommendation refresh', symbol, err)
    }

    return { symbol, ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Refresh failed for ${symbol}:`, message)
    return { symbol, ok: false, error: message }
  }
}

export async function refreshAllStocks(): Promise<RefreshResult[]> {
  const stocks = await prisma.stock.findMany()
  const results: RefreshResult[] = []
  for (const stock of stocks) {
    results.push(await refreshStock(stock.symbol))
  }
  return results
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/refresh.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/refresh.ts tests/lib/refresh.test.ts
git commit -m "feat: write evaluation fields and isolate recommendation refresh"
```

---

### Task 4: Evaluation module

**Files:**
- Create: `lib/evaluate.ts`
- Test: `tests/lib/evaluate.test.ts`

**Interfaces:**
- Produces: `SignalResult`, `Evaluation`, `EvaluateInput`,
  `evaluateStock(input: EvaluateInput): Evaluation` — exact shapes
  below. Pure function, no imports from `./db` or `./finnhub`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/evaluate.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateStock, type EvaluateInput } from '@/lib/evaluate'

function baseInput(overrides: Partial<EvaluateInput['latestSnapshot']> = {}): EvaluateInput {
  return {
    latestSnapshot: {
      price: 100,
      week52High: null,
      week52Low: null,
      relativePerf13W: null,
      pegRatio: null,
      roe: null,
      debtToEquity: null,
      netMargin: null,
      dividendYield: null,
      payoutRatio: null,
      epsTTM: null,
      epsGrowth5Y: null,
      ...overrides,
    },
    earliestSnapshot: null,
    recentRecommendations: [],
  }
}

describe('evaluateStock — sinceWatching', () => {
  it('is null with a note when there is no earlier snapshot', () => {
    const result = evaluateStock(baseInput())
    expect(result.sinceWatching.pct).toBeNull()
    expect(result.sinceWatching.note).toMatch(/appena aggiunto/i)
  })

  it('computes the percent change from the earliest snapshot', () => {
    const input = baseInput()
    input.earliestSnapshot = { price: 100, timestamp: new Date('2026-10-01') }
    input.latestSnapshot.price = 120
    const result = evaluateStock(input)
    expect(result.sinceWatching.pct).toBeCloseTo(20)
    expect(result.sinceWatching.note).toContain('+20.0%')
  })

  it('shows a negative percent correctly', () => {
    const input = baseInput()
    input.earliestSnapshot = { price: 100, timestamp: new Date('2026-10-01') }
    input.latestSnapshot.price = 80
    const result = evaluateStock(input)
    expect(result.sinceWatching.pct).toBeCloseTo(-20)
    expect(result.sinceWatching.note).toContain('-20.0%')
  })
})

describe('evaluateStock — shortTerm', () => {
  it('is Neutro with a not-available note when 52-week range or relative performance is missing', () => {
    const result = evaluateStock(baseInput())
    expect(result.shortTerm.label).toBe('Neutro')
    expect(result.shortTerm.note).toMatch(/non disponibili/i)
  })

  it('is Positivo near the 52-week high with positive relative performance', () => {
    const input = baseInput({ price: 195, week52High: 200, week52Low: 100, relativePerf13W: 2 })
    const result = evaluateStock(input)
    expect(result.shortTerm.label).toBe('Positivo')
  })

  it('is Negativo near the 52-week low with negative relative performance', () => {
    const input = baseInput({ price: 105, week52High: 200, week52Low: 100, relativePerf13W: -2 })
    const result = evaluateStock(input)
    expect(result.shortTerm.label).toBe('Negativo')
  })

  it('is Neutro when price sits mid-range', () => {
    const input = baseInput({ price: 150, week52High: 200, week52Low: 100, relativePerf13W: 1 })
    const result = evaluateStock(input)
    expect(result.shortTerm.label).toBe('Neutro')
  })
})

describe('evaluateStock — mediumTerm', () => {
  it('shows "Nessun dato disponibile" with no recommendations', () => {
    const result = evaluateStock(baseInput())
    expect(result.mediumTerm.label).toBe('Nessun dato disponibile')
  })

  it('is positive without a trend suffix with a single strongly-positive period', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 20, buy: 5, hold: 2, sell: 0, strongSell: 0 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.label).toBe('Consenso positivo')
  })

  it('reports improving consensus across two periods', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 20, buy: 5, hold: 2, sell: 0, strongSell: 0 },
      { period: new Date('2026-10-01'), strongBuy: 10, buy: 5, hold: 10, sell: 2, strongSell: 0 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.label).toBe('Consenso positivo, in miglioramento')
  })

  it('reports declining consensus across two periods', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 15, buy: 5, hold: 5, sell: 0, strongSell: 0 },
      { period: new Date('2026-10-01'), strongBuy: 20, buy: 5, hold: 2, sell: 0, strongSell: 0 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.label).toBe('Consenso positivo, ma in calo')
  })

  it('reports negative consensus', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 0, buy: 1, hold: 2, sell: 10, strongSell: 10 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.label).toBe('Consenso negativo')
  })

  it('includes the raw analyst counts in the note', () => {
    const input = baseInput()
    input.recentRecommendations = [
      { period: new Date('2026-11-01'), strongBuy: 11, buy: 19, hold: 15, sell: 3, strongSell: 1 },
    ]
    const result = evaluateStock(input)
    expect(result.mediumTerm.note).toContain('30 analisti su 49')
    expect(result.mediumTerm.note).toContain('15 sono neutrali')
    expect(result.mediumTerm.note).toContain('4 raccomandano la vendita')
  })
})

describe('evaluateStock — longTerm', () => {
  it('shows "Dati fondamentali non disponibili" when PEG, ROE, and debt are all missing', () => {
    const result = evaluateStock(baseInput())
    expect(result.longTerm.label).toBe('Dati fondamentali non disponibili')
  })

  it('is "Fondamentali solidi" when PEG, ROE, and debt are all in their best bracket', () => {
    const input = baseInput({ pegRatio: 0.8, roe: 20, debtToEquity: 0.5 })
    const result = evaluateStock(input)
    expect(result.longTerm.label).toBe('Fondamentali solidi')
  })

  it('is "Fondamentali deboli" when ROE is negative, regardless of the others', () => {
    const input = baseInput({ pegRatio: 0.8, roe: -5, debtToEquity: 0.5 })
    const result = evaluateStock(input)
    expect(result.longTerm.label).toBe('Fondamentali deboli')
  })

  it('is "Fondamentali deboli" when debt is elevated, regardless of the others', () => {
    const input = baseInput({ pegRatio: 0.8, roe: 20, debtToEquity: 3 })
    const result = evaluateStock(input)
    expect(result.longTerm.label).toBe('Fondamentali deboli')
  })

  it('is "Fondamentali nella norma" for mid-range values', () => {
    const input = baseInput({ pegRatio: 1.5, roe: 8, debtToEquity: 1.2 })
    const result = evaluateStock(input)
    expect(result.longTerm.label).toBe('Fondamentali nella norma')
  })

  it('excludes a null or non-positive PEG from the combination without excluding ROE/debt data', () => {
    const input = baseInput({ pegRatio: null, roe: 20, debtToEquity: 0.5 })
    const result = evaluateStock(input)
    expect(result.longTerm.label).toBe('Fondamentali nella norma')
    expect(result.longTerm.note).toMatch(/PEG non disponibile/)
  })
})

describe('evaluateStock — targetPrice', () => {
  it('is not available when epsGrowth5Y is null', () => {
    const input = baseInput({ epsTTM: 6, epsGrowth5Y: null })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeNull()
    expect(result.targetPrice.note).toMatch(/non disponibile/i)
  })

  it('is not available when trailing EPS is zero or negative', () => {
    const input = baseInput({ epsTTM: -1, epsGrowth5Y: 15 })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeNull()
  })

  it('computes a value using the clamped growth rate as the fair P/E', () => {
    const input = baseInput({ price: 100, epsTTM: 5, epsGrowth5Y: 12 })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeCloseTo(60) // fairPE 12 * eps 5
    expect(result.targetPrice.upsidePct).toBeCloseTo(-40)
    expect(result.targetPrice.note).toMatch(/stima indicativa/i)
  })

  it('clamps an extreme growth rate to the formula\'s upper bound', () => {
    const input = baseInput({ price: 100, epsTTM: 5, epsGrowth5Y: 500 })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeCloseTo(200) // fairPE clamped to 40 * eps 5
  })

  it('clamps a negative growth rate to the formula\'s lower bound rather than excluding it', () => {
    const input = baseInput({ price: 100, epsTTM: 5, epsGrowth5Y: -10 })
    const result = evaluateStock(input)
    expect(result.targetPrice.value).toBeCloseTo(25) // fairPE clamped to 5 * eps 5
  })
})

describe('evaluateStock — details', () => {
  it('passes the raw metric values through unchanged', () => {
    const input = baseInput({
      pegRatio: 1.1, roe: 18, debtToEquity: 0.9, netMargin: 22, dividendYield: 0.5, payoutRatio: 10,
    })
    const result = evaluateStock(input)
    expect(result.details).toEqual({
      pegRatio: 1.1, roe: 18, debtToEquity: 0.9, netMargin: 22, dividendYield: 0.5, payoutRatio: 10,
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/evaluate.test.ts`
Expected: FAIL with "Cannot find module '@/lib/evaluate'".

- [ ] **Step 3: Implement `lib/evaluate.ts`**

```typescript
// lib/evaluate.ts
export interface SignalResult {
  label: string
  note: string
}

export interface Evaluation {
  sinceWatching: { pct: number | null; sinceDate: Date | null; note: string }
  shortTerm: SignalResult
  mediumTerm: SignalResult & { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }
  longTerm: SignalResult
  targetPrice: { value: number | null; upsidePct: number | null; note: string }
  details: {
    pegRatio: number | null
    roe: number | null
    debtToEquity: number | null
    netMargin: number | null
    dividendYield: number | null
    payoutRatio: number | null
  }
}

export interface EvaluateInput {
  latestSnapshot: {
    price: number
    week52High: number | null
    week52Low: number | null
    relativePerf13W: number | null
    pegRatio: number | null
    roe: number | null
    debtToEquity: number | null
    netMargin: number | null
    dividendYield: number | null
    payoutRatio: number | null
    epsTTM: number | null
    epsGrowth5Y: number | null
  }
  earliestSnapshot: { price: number; timestamp: Date } | null
  recentRecommendations: Array<{
    period: Date
    strongBuy: number
    buy: number
    hold: number
    sell: number
    strongSell: number
  }>
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function evaluateSinceWatching(input: EvaluateInput): Evaluation['sinceWatching'] {
  const { latestSnapshot, earliestSnapshot } = input
  if (!earliestSnapshot) {
    return { pct: null, sinceDate: null, note: 'Appena aggiunto, nessun dato storico ancora.' }
  }
  const pct = ((latestSnapshot.price - earliestSnapshot.price) / earliestSnapshot.price) * 100
  const dateStr = earliestSnapshot.timestamp.toLocaleDateString('it-IT')
  const sign = pct >= 0 ? '+' : ''
  return {
    pct,
    sinceDate: earliestSnapshot.timestamp,
    note: `Da quando segui questo titolo (dal ${dateStr}): ${sign}${pct.toFixed(1)}%.`,
  }
}

function evaluateShortTerm(input: EvaluateInput): SignalResult {
  const { price, week52High, week52Low, relativePerf13W } = input.latestSnapshot
  if (week52High === null || week52Low === null || week52High === week52Low || relativePerf13W === null) {
    return { label: 'Neutro', note: 'Dati di momentum non disponibili per questo titolo.' }
  }
  const position52w = (price - week52Low) / (week52High - week52Low)
  if (position52w > 0.8 && relativePerf13W > 0) {
    return {
      label: 'Positivo',
      note:
        "Il prezzo è vicino al massimo delle ultime 52 settimane e sta andando meglio dell'indice S&P 500 nelle ultime 13 settimane.",
    }
  }
  if (position52w < 0.2 && relativePerf13W < 0) {
    return {
      label: 'Negativo',
      note:
        "Il prezzo è vicino al minimo delle ultime 52 settimane e sta andando peggio dell'indice S&P 500 nelle ultime 13 settimane.",
    }
  }
  return {
    label: 'Neutro',
    note: 'Il prezzo non mostra un momentum chiaro rispetto alle ultime 52 settimane e al mercato.',
  }
}

function recommendationScore(r: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }): number {
  const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell
  if (total === 0) return 0
  return (r.strongBuy * 2 + r.buy - r.sell - r.strongSell * 2) / total
}

function evaluateMediumTerm(input: EvaluateInput): Evaluation['mediumTerm'] {
  const recs = input.recentRecommendations
  if (recs.length === 0) {
    return {
      label: 'Nessun dato disponibile',
      note: 'Nessun dato sul consenso degli analisti disponibile per questo titolo.',
      strongBuy: 0,
      buy: 0,
      hold: 0,
      sell: 0,
      strongSell: 0,
    }
  }

  const latest = recs[0]
  const latestScore = recommendationScore(latest)
  const buyLeaning = latest.strongBuy + latest.buy
  const sellLeaning = latest.sell + latest.strongSell
  const total = buyLeaning + latest.hold + sellLeaning
  const countsNote = `${buyLeaning} analisti su ${total} raccomandano l'acquisto, ${latest.hold} sono neutrali, ${sellLeaning} raccomandano la vendita.`

  let label: string
  if (recs.length === 1) {
    label = latestScore > 0.5 ? 'Consenso positivo' : latestScore < -0.5 ? 'Consenso negativo' : 'Consenso misto'
  } else {
    const previousScore = recommendationScore(recs[1])
    if (latestScore > 0.5 && latestScore >= previousScore) {
      label = 'Consenso positivo, in miglioramento'
    } else if (latestScore > 0.5) {
      label = 'Consenso positivo, ma in calo'
    } else if (latestScore < -0.5) {
      label = 'Consenso negativo'
    } else {
      label = 'Consenso misto'
    }
  }

  return { label, note: countsNote, strongBuy: latest.strongBuy, buy: latest.buy, hold: latest.hold, sell: latest.sell, strongSell: latest.strongSell }
}

function evaluateLongTerm(input: EvaluateInput): SignalResult {
  const { pegRatio, roe, debtToEquity } = input.latestSnapshot
  const pegMeaningful = pegRatio !== null && pegRatio > 0
  const hasAny = pegMeaningful || roe !== null || debtToEquity !== null

  if (!hasAny) {
    return {
      label: 'Dati fondamentali non disponibili',
      note: 'Non ci sono abbastanza dati fondamentali per valutare questo titolo nel lungo periodo.',
    }
  }

  const pegGood = pegMeaningful && (pegRatio as number) <= 1
  const roeNegative = roe !== null && roe <= 0
  const debtElevated = debtToEquity !== null && debtToEquity >= 2
  const roeSolid = roe !== null && roe > 15
  const debtSano = debtToEquity !== null && debtToEquity < 1

  let label: string
  if (roeNegative || debtElevated) {
    label = 'Fondamentali deboli'
  } else if (pegGood && roeSolid && debtSano) {
    label = 'Fondamentali solidi'
  } else {
    label = 'Fondamentali nella norma'
  }

  const pegNote = pegMeaningful ? `PEG ${(pegRatio as number).toFixed(2)}` : 'PEG non disponibile'
  const roeNote = roe !== null ? `ROE ${roe.toFixed(1)}%` : 'ROE non disponibile'
  const debtNote = debtToEquity !== null ? `debito/capitale ${debtToEquity.toFixed(2)}` : 'debito/capitale non disponibile'

  return { label, note: `${pegNote}, ${roeNote}, ${debtNote}.` }
}

function evaluateTargetPrice(input: EvaluateInput): Evaluation['targetPrice'] {
  const { epsGrowth5Y, epsTTM, price } = input.latestSnapshot
  if (epsGrowth5Y === null || epsTTM === null || epsTTM <= 0) {
    return {
      value: null,
      upsidePct: null,
      note: 'Stima non disponibile: utili o crescita storica non adatti a questo calcolo.',
    }
  }
  const fairPE = clamp(epsGrowth5Y, 5, 40)
  const value = fairPE * epsTTM
  const upsidePct = ((value - price) / price) * 100
  return {
    value,
    upsidePct,
    note:
      "Stima indicativa basata sulla crescita storica degli utili (formula P/E = crescita, stile 'Peter Lynch'). Non è una previsione di mercato né un consiglio di investimento.",
  }
}

export function evaluateStock(input: EvaluateInput): Evaluation {
  return {
    sinceWatching: evaluateSinceWatching(input),
    shortTerm: evaluateShortTerm(input),
    mediumTerm: evaluateMediumTerm(input),
    longTerm: evaluateLongTerm(input),
    targetPrice: evaluateTargetPrice(input),
    details: {
      pegRatio: input.latestSnapshot.pegRatio,
      roe: input.latestSnapshot.roe,
      debtToEquity: input.latestSnapshot.debtToEquity,
      netMargin: input.latestSnapshot.netMargin,
      dividendYield: input.latestSnapshot.dividendYield,
      payoutRatio: input.latestSnapshot.payoutRatio,
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/evaluate.test.ts`
Expected: PASS (23 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/evaluate.ts tests/lib/evaluate.test.ts
git commit -m "feat: add pure stock evaluation logic"
```

---

### Task 5: EvaluationPanel component

**Files:**
- Create: `components/EvaluationPanel.tsx`
- Create: `components/EvaluationPanel.module.css`
- Test: `tests/components/EvaluationPanel.test.tsx`

**Interfaces:**
- Consumes: `Evaluation` type from `@/lib/evaluate` (Task 4).
- Produces: `EvaluationPanel({ evaluation: Evaluation })` component,
  named export.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/components/EvaluationPanel.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EvaluationPanel } from '@/components/EvaluationPanel'
import type { Evaluation } from '@/lib/evaluate'

function fullEvaluation(): Evaluation {
  return {
    sinceWatching: { pct: 12.3, sinceDate: new Date('2026-10-01'), note: 'Da quando segui questo titolo (dal 01/10/2026): +12.3%.' },
    shortTerm: { label: 'Positivo', note: 'Il prezzo è vicino al massimo delle ultime 52 settimane.' },
    mediumTerm: { label: 'Consenso positivo, in miglioramento', note: '30 analisti su 49 raccomandano l\'acquisto.', strongBuy: 11, buy: 19, hold: 15, sell: 3, strongSell: 1 },
    longTerm: { label: 'Fondamentali solidi', note: 'PEG 0.80, ROE 20.0%, debito/capitale 0.50.' },
    targetPrice: { value: 60, upsidePct: -40, note: "Stima indicativa basata sulla crescita storica degli utili." },
    details: { pegRatio: 0.8, roe: 20, debtToEquity: 0.5, netMargin: 22, dividendYield: 0.5, payoutRatio: 10 },
  }
}

function emptyEvaluation(): Evaluation {
  return {
    sinceWatching: { pct: null, sinceDate: null, note: 'Appena aggiunto, nessun dato storico ancora.' },
    shortTerm: { label: 'Neutro', note: 'Dati di momentum non disponibili per questo titolo.' },
    mediumTerm: { label: 'Nessun dato disponibile', note: 'Nessun dato sul consenso degli analisti disponibile per questo titolo.', strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 },
    longTerm: { label: 'Dati fondamentali non disponibili', note: 'Non ci sono abbastanza dati fondamentali per valutare questo titolo nel lungo periodo.' },
    targetPrice: { value: null, upsidePct: null, note: 'Stima non disponibile: utili o crescita storica non adatti a questo calcolo.' },
    details: { pegRatio: null, roe: null, debtToEquity: null, netMargin: null, dividendYield: null, payoutRatio: null },
  }
}

describe('EvaluationPanel', () => {
  it('renders all five signal rows with their labels and notes', () => {
    render(<EvaluationPanel evaluation={fullEvaluation()} />)
    expect(screen.getByText('+12.3%')).toBeInTheDocument()
    expect(screen.getByText('Positivo')).toBeInTheDocument()
    expect(screen.getByText('Consenso positivo, in miglioramento')).toBeInTheDocument()
    expect(screen.getByText('Fondamentali solidi')).toBeInTheDocument()
    expect(screen.getByText('$60.00')).toBeInTheDocument()
    expect(screen.getByText(/stima indicativa/i)).toBeInTheDocument()
  })

  it('renders every not-available note without crashing for a freshly-added stock', () => {
    render(<EvaluationPanel evaluation={emptyEvaluation()} />)
    expect(screen.getByText(/appena aggiunto/i)).toBeInTheDocument()
    expect(screen.getByText('Nessun dato disponibile')).toBeInTheDocument()
    expect(screen.getByText('Dati fondamentali non disponibili')).toBeInTheDocument()
    expect(screen.getByText(/stima non disponibile/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/EvaluationPanel.test.tsx`
Expected: FAIL with "Cannot find module '@/components/EvaluationPanel'".

- [ ] **Step 3: Implement the component and its styles**

```tsx
// components/EvaluationPanel.tsx
import styles from './EvaluationPanel.module.css'
import type { Evaluation } from '@/lib/evaluate'

function fmtPct(pct: number | null): string {
  if (pct === null) return '—'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

export function EvaluationPanel({ evaluation }: { evaluation: Evaluation }) {
  const { sinceWatching, shortTerm, mediumTerm, longTerm, targetPrice, details } = evaluation

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>Valutazione</h2>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>Da quando lo segui</span>
          <span className={styles.value}>{fmtPct(sinceWatching.pct)}</span>
        </div>
        <p className={styles.note}>{sinceWatching.note}</p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>Segnale breve termine</span>
          <span className={styles.value}>{shortTerm.label}</span>
        </div>
        <p className={styles.note}>{shortTerm.note}</p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>Segnale medio termine</span>
          <span className={styles.value}>{mediumTerm.label}</span>
        </div>
        <p className={styles.note}>{mediumTerm.note}</p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>Segnale lungo termine</span>
          <span className={styles.value}>{longTerm.label}</span>
        </div>
        <p className={styles.note}>{longTerm.note}</p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>Target price stimato</span>
          <span className={styles.value}>{targetPrice.value === null ? '—' : `$${targetPrice.value.toFixed(2)}`}</span>
        </div>
        <p className={styles.note}>{targetPrice.note}</p>
      </div>

      <details className={styles.details}>
        <summary className={styles.summary}>Dettagli numerici</summary>
        <dl className={styles.detailList}>
          <div className={styles.detailRow}>
            <dt>PEG ratio</dt>
            <dd>{details.pegRatio ?? '—'}</dd>
          </div>
          <div className={styles.detailRow}>
            <dt>ROE</dt>
            <dd>{details.roe ?? '—'}</dd>
          </div>
          <div className={styles.detailRow}>
            <dt>Debt / equity</dt>
            <dd>{details.debtToEquity ?? '—'}</dd>
          </div>
          <div className={styles.detailRow}>
            <dt>Margine netto</dt>
            <dd>{details.netMargin ?? '—'}</dd>
          </div>
          <div className={styles.detailRow}>
            <dt>Dividend yield</dt>
            <dd>{details.dividendYield ?? '—'}</dd>
          </div>
          <div className={styles.detailRow}>
            <dt>Payout ratio</dt>
            <dd>{details.payoutRatio ?? '—'}</dd>
          </div>
        </dl>
      </details>
    </section>
  )
}
```

```css
/* components/EvaluationPanel.module.css */
.panel {
  margin-bottom: 48px;
}

.title {
  font-size: 14px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 16px;
}

.row {
  border-top: 1px solid var(--rule);
  padding: 14px 0;
}

.rowHead {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
}

.label {
  color: var(--muted);
}

.value {
  font-family: var(--font-display);
  font-feature-settings: "onum" 1, "tnum" 1;
}

.note {
  margin-top: 4px;
  font-size: 13px;
  color: var(--muted);
}

.details {
  border-top: 1px solid var(--rule);
  padding-top: 14px;
  margin-top: 4px;
}

.summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
}

.summary:hover {
  color: var(--brass);
}

.detailList {
  margin-top: 12px;
}

.detailRow {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 13px;
  border-top: 1px solid var(--rule);
}

.detailRow dt {
  color: var(--muted);
}

.detailRow dd {
  font-family: var(--font-display);
  font-feature-settings: "onum" 1, "tnum" 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/components/EvaluationPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/EvaluationPanel.tsx components/EvaluationPanel.module.css tests/components/EvaluationPanel.test.tsx
git commit -m "feat: add EvaluationPanel component"
```

---

### Task 6: Wire into the stock detail page

**Files:**
- Modify: `app/stock/[symbol]/page.tsx`

**Interfaces:**
- Consumes: `evaluateStock` from `@/lib/evaluate` (Task 4),
  `EvaluationPanel` from `@/components/EvaluationPanel` (Task 5).

- [ ] **Step 1: Fetch the earliest snapshot and recent recommendations, call `evaluateStock`, render `EvaluationPanel`**

```tsx
// app/stock/[symbol]/page.tsx — full replacement
import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { PriceChart } from '@/components/PriceChart'
import { NewsList } from '@/components/NewsList'
import { RefreshButton } from '@/components/RefreshButton'
import { EvaluationPanel } from '@/components/EvaluationPanel'
import { evaluateStock } from '@/lib/evaluate'
import styles from './page.module.css'

function formatExchange(exchange: string): string {
  if (exchange.includes('NASDAQ')) return 'NASDAQ'
  if (exchange.includes('NYSE')) return 'NYSE'
  return exchange.split(' - ')[0]
}

async function StockDetail({ paramsPromise }: { paramsPromise: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await paramsPromise
  const symbol = rawSymbol.toUpperCase()

  const stock = await prisma.stock.findUnique({
    where: { symbol },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 100 },
      news: { orderBy: { publishedAt: 'desc' }, take: 20 },
      recommendations: { orderBy: { period: 'desc' }, take: 2 },
    },
  })

  if (!stock) {
    notFound()
  }

  const latest = stock.snapshots[0]
  const changeClass = latest ? (latest.changePct >= 0 ? styles.gain : styles.loss) : ''

  const earliestSnapshot =
    stock.snapshots.length > 1
      ? await prisma.priceSnapshot.findFirst({
          where: { stockId: stock.id },
          orderBy: { timestamp: 'asc' },
        })
      : null

  const evaluation = latest
    ? evaluateStock({
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
        earliestSnapshot: earliestSnapshot ? { price: earliestSnapshot.price, timestamp: earliestSnapshot.timestamp } : null,
        recentRecommendations: stock.recommendations.map((r) => ({
          period: r.period,
          strongBuy: r.strongBuy,
          buy: r.buy,
          hold: r.hold,
          sell: r.sell,
          strongSell: r.strongSell,
        })),
      })
    : null

  return (
    <>
      <Link href="/" className={styles.back}>
        ← Watchlist
      </Link>

      <p className={styles.ticker}>
        {formatExchange(stock.exchange)}: {stock.symbol}
      </p>
      <h1 className={styles.name}>{stock.name}</h1>

      {latest ? (
        <>
          <div className={styles.heroRow}>
            <span className={styles.price}>${latest.price.toFixed(2)}</span>
            <span className={`${styles.change} ${changeClass}`}>
              {latest.changePct >= 0 ? '+' : ''}
              {latest.changePct.toFixed(2)}%
            </span>
            <span className={`${styles.sparkline} ${changeClass}`}>
              <PriceChart snapshots={stock.snapshots} width={100} height={32} strokeWidth={1.5} compact />
            </span>
          </div>
          <p className={styles.stale}>Updated {latest.timestamp.toLocaleString()}</p>
        </>
      ) : (
        <p className={styles.stale}>No data yet. Refresh to fetch the latest snapshot.</p>
      )}

      <div className={styles.actions}>
        <RefreshButton symbol={stock.symbol} />
      </div>

      {latest && (
        <dl className={styles.metrics}>
          <div className={styles.metricRow}>
            <dt className={styles.metricLabel}>P/E ratio</dt>
            <dd className={styles.metricValue}>{latest.peRatio?.toFixed(1) ?? '—'}</dd>
          </div>
          <div className={styles.metricRow}>
            <dt className={styles.metricLabel}>Market cap</dt>
            <dd className={styles.metricValue}>{latest.marketCap ?? '—'}</dd>
          </div>
          <div className={styles.metricRow}>
            <dt className={styles.metricLabel}>52-week range</dt>
            <dd className={styles.metricValue}>
              {latest.week52Low ?? '—'} – {latest.week52High ?? '—'}
            </dd>
          </div>
        </dl>
      )}

      {evaluation && <EvaluationPanel evaluation={evaluation} />}

      <p className={styles.newsTitle}>Recent news</p>
      <NewsList news={stock.news} />
    </>
  )
}

export default function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  return (
    <main className={styles.shell}>
      <Suspense fallback={<p className={styles.stale}>Loading stock…</p>}>
        <StockDetail paramsPromise={params} />
      </Suspense>
    </main>
  )
}
```

This drops the old static `.considerations`/`.considerationsTitle`/
`.considerationsBody` block entirely — `EvaluationPanel` replaces it.
Those three classes become unused in `page.module.css`; leave the CSS
file as-is (removing unused CSS is cosmetic, not required for this
task).

- [ ] **Step 2: Run the full suite and the build**

Run:
```bash
npm test
npx tsc --noEmit
npm run build
```
Expected: all tests pass; typecheck clean; build succeeds with
`/stock/[symbol]` still reported as Partial Prerender (same as
before — this task adds a DB query and a pure computation inside the
existing `Suspense` boundary, it does not move anything outside it).

- [ ] **Step 3: Verify manually**

Run `npm run dev`, open a stock detail page for a symbol already in
the watchlist with at least one refresh done, confirm:
- The "Valutazione" section appears where "Considerations" used to be.
- All five rows render with a label, a value, and an Italian note.
- The "Dettagli numerici" disclosure is closed by default and expands
  to show the six raw numbers on click.
- A stock added moments ago (one snapshot, no recommendations yet)
  shows the not-available notes for every row instead of crashing or
  showing misleading numbers.

- [ ] **Step 4: Commit**

```bash
git add app/stock/\[symbol\]/page.tsx
git commit -m "feat: wire evaluation panel into the stock detail page"
```

---

## Self-Review Notes

**Spec coverage:** data model (Task 1), Finnhub client (Task 2),
refresh isolation (Task 3), all five signals and their exact
thresholds (Task 4), UI layout and progressive disclosure (Task 5),
page wiring with the dedicated earliest-snapshot query (Task 6). Every
non-goal (no paid tier, no invented predictions) is respected by
construction — `evaluateStock` never calls `/stock/price-target` and
every "estimate" branch carries its labeling note verbatim from the
spec.

**Placeholder scan:** none found — every step has runnable code or an
exact command.

**Type consistency:** `FinnhubMetrics` (Task 2) field names match the
`PriceSnapshot` columns they're written into (Task 1) and the
`EvaluateInput['latestSnapshot']` shape they're read back into (Task
4) — `pegRatio`, `roe`, `netMargin`, `debtToEquity`, `dividendYield`,
`payoutRatio`, `relativePerf13W`, `epsTTM`, `epsGrowth5Y` are spelled
identically across all three. `Evaluation` (Task 4) and the props
`EvaluationPanel` destructures (Task 5) match field-for-field.

**Review Focus:** all five items have an owning task and a test,
listed in the Review Focus section above.

---

**Plan complete and saved to
`docs/superpowers/plans/2026-11-12-stock-evaluation.md`.** You already
chose native execution. For this plan I'd have recommended native
anyway: six tasks with a clear, mostly-linear dependency chain (schema
→ Finnhub client → refresh → pure evaluation logic → component →
page), no task where a shipped mistake is expensive to find (every
branch is unit-tested before it ever reaches the page), and a single
developer can hold the whole thing in context at once.

**REQUIRED SUB-SKILL:** Use superpowers:executing-plans.
