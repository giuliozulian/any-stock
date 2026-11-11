# Any-Stock MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal Next.js web app that tracks a watchlist of 5–20
stocks, showing current price, key metrics, and recent news per stock,
refreshed on a schedule from Finnhub.

**Architecture:** Next.js 15 (App Router) full-stack app. API routes call
Finnhub server-side and persist snapshots/news to Postgres via Prisma.
Vercel Cron triggers scheduled refresh; a manual refresh endpoint exists
per stock. Server Components render pages directly from the DB.

**Tech Stack:** Next.js 15, TypeScript, Prisma ORM, Postgres (Neon for
production, local Docker Postgres for tests), Finnhub REST API, Vitest +
React Testing Library, deployed on Vercel.

**Spec:** `docs/superpowers/specs/2026-11-11-any-stock-mvp-design.md`

## Global Constraints

- Framework: Next.js 15, App Router, TypeScript.
- Database: Postgres via Prisma ORM (no other ORM/query builder).
- Data source: Finnhub only for this MVP (forecaster.biz deferred, not implemented).
- No authentication, no multi-user support, no access protection on the public UI (owner's explicit choice).
- Valuation/scoring logic is explicitly out of scope — the detail page must show an empty "Considerations" placeholder, not a stub implementation.
- Deploy target: Vercel, with Vercel Cron for scheduled refresh.
- All Finnhub calls happen server-side only; the API key must never reach the browser.

## Review Focus

- Adding a watchlist symbol that Finnhub doesn't recognize (typo) must return a clear 404-style message, not a crash or a half-created `Stock` row. (Task 5)
- Removing a stock must cascade-delete its snapshots and news so no orphan rows remain in Postgres. (Task 5)
- Adding a symbol already in the watchlist must return a friendly 409 conflict, not a Prisma unique-constraint stack trace. (Task 5)
- One symbol's Finnhub failure during the scheduled cron refresh must not stop the other symbols in the watchlist from refreshing. (Task 6)
- An empty watchlist, and a stock with 0 or 1 price snapshots, must render a sensible empty/partial state on both pages instead of crashing the chart or table. (Task 7, Task 8)

---

## File Structure

```
any-stock/
├── prisma/
│   └── schema.prisma
├── lib/
│   ├── db.ts                     # Prisma client singleton
│   ├── finnhub.ts                # Finnhub REST client
│   └── refresh.ts                # refreshStock / refreshAllStocks
├── app/
│   ├── page.tsx                  # watchlist page
│   ├── stock/[symbol]/page.tsx   # stock detail page
│   └── api/
│       ├── stocks/
│       │   ├── route.ts                  # GET list, POST add
│       │   └── [symbol]/
│       │       ├── route.ts              # GET detail, DELETE remove
│       │       └── refresh/route.ts      # POST manual refresh
│       └── cron/
│           └── refresh/route.ts          # GET scheduled refresh (Vercel Cron)
├── components/
│   ├── AddStockForm.tsx
│   ├── PriceChart.tsx
│   └── NewsList.tsx
├── tests/
│   ├── setup.ts                   # vitest setup (jsdom matchers)
│   └── helpers/db.ts              # resetDb() for integration tests
├── docker-compose.test.yml
├── vercel.json
├── vitest.config.ts
└── .env.test
```

---

### Task 1: Project scaffold and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore` (update), `.env.example`
- Create: `vitest.config.ts`, `tests/setup.ts`
- Create: `app/layout.tsx`, `app/page.tsx` (placeholder, replaced in Task 7)

**Interfaces:**
- Produces: a buildable Next.js + TypeScript project with `@/*` path alias resolving to the repo root, and `npm test` running Vitest.

- [ ] **Step 1: Scaffold Next.js app**

```bash
npx create-next-app@latest . --typescript --app --no-tailwind --eslint --src-dir=false --import-alias "@/*" --use-npm
```

Answer prompts to keep an existing (empty-ish) directory; this creates `package.json`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `next.config.ts`.

- [ ] **Step 2: Install runtime and dev dependencies**

```bash
npm install @prisma/client
npm install -D prisma vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @types/node
```

- [ ] **Step 3: Add Vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

```typescript
// tests/setup.ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Add test script to package.json**

Edit `package.json` `scripts` to add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Add `.env.example` documenting required env vars**

```bash
# .env.example
DATABASE_URL="postgresql://user:password@host/db"
FINNHUB_API_KEY="your-finnhub-api-key"
CRON_SECRET="a-long-random-string"
```

- [ ] **Step 6: Verify the project builds and the test runner works**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

Run: `npm test`
Expected: Vitest runs with 0 test files found (no failures) — confirms the runner itself works before any tests exist.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js project with Vitest"
```

---

### Task 2: Database schema and Prisma client

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/db.ts`
- Create: `docker-compose.test.yml`, `.env.test`
- Create: `tests/helpers/db.ts`
- Test: `tests/helpers/db.test.ts`

**Interfaces:**
- Produces: `prisma` (singleton `PrismaClient` from `lib/db.ts`), Prisma models `Stock`, `PriceSnapshot`, `NewsItem` with fields as below, and `resetDb()` from `tests/helpers/db.ts` for integration tests.

Note on spec refinement: `PriceSnapshot.volume` is `BigInt?` (nullable), not required — Finnhub's `/quote` endpoint does not return volume, so there is no real value to store; writing a fake `0` would misrepresent the data. `NewsItem.url` is `@unique` and both relations use `onDelete: Cascade`, needed to satisfy the Review Focus cascade-delete requirement.

- [ ] **Step 1: Write the Prisma schema**

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Stock {
  id        String          @id @default(cuid())
  symbol    String          @unique
  name      String
  exchange  String
  addedAt   DateTime        @default(now())
  snapshots PriceSnapshot[]
  news      NewsItem[]
}

model PriceSnapshot {
  id         String   @id @default(cuid())
  stockId    String
  stock      Stock    @relation(fields: [stockId], references: [id], onDelete: Cascade)
  price      Float
  changePct  Float
  volume     BigInt?
  marketCap  Float?
  peRatio    Float?
  week52High Float?
  week52Low  Float?
  timestamp  DateTime @default(now())

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
```

- [ ] **Step 2: Add Prisma client singleton**

```typescript
// lib/db.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
```

- [ ] **Step 3: Add a local Postgres for tests via Docker**

```yaml
# docker-compose.test.yml
services:
  postgres-test:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: any_stock_test
    ports:
      - '5433:5432'
```

```bash
# .env.test
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/any_stock_test"
FINNHUB_API_KEY="test-key"
CRON_SECRET="test-secret"
```

- [ ] **Step 4: Add `resetDb()` test helper**

```typescript
// tests/helpers/db.ts
import { prisma } from '@/lib/db'

export async function resetDb(): Promise<void> {
  await prisma.newsItem.deleteMany()
  await prisma.priceSnapshot.deleteMany()
  await prisma.stock.deleteMany()
}
```

- [ ] **Step 5: Write the failing test**

```typescript
// tests/helpers/db.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from './db'

describe('database setup', () => {
  beforeEach(resetDb)

  it('creates and reads back a stock with cascading snapshot delete', async () => {
    const stock = await prisma.stock.create({
      data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
    })

    await prisma.priceSnapshot.create({
      data: { stockId: stock.id, price: 150.0, changePct: 1.2 },
    })

    const found = await prisma.stock.findUnique({
      where: { symbol: 'AAPL' },
      include: { snapshots: true },
    })
    expect(found?.snapshots).toHaveLength(1)

    await prisma.stock.delete({ where: { symbol: 'AAPL' } })

    const orphanSnapshots = await prisma.priceSnapshot.findMany({ where: { stockId: stock.id } })
    expect(orphanSnapshots).toHaveLength(0)
  })
})
```

- [ ] **Step 6: Start the test database and run migrations**

Run:
```bash
docker compose -f docker-compose.test.yml up -d
export $(cat .env.test | xargs) && npx prisma migrate dev --name init
```
Expected: migration creates `Stock`, `PriceSnapshot`, `NewsItem` tables in `any_stock_test`.

- [ ] **Step 7: Run the test to verify it fails before the client exists, then passes after**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/any_stock_test" npm test -- tests/helpers/db.test.ts`
Expected: PASS (schema and client already written in Steps 1–2 — this step confirms the cascade delete actually works against a real Postgres instance).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema, db client, and test database setup"
```

---

### Task 3: Finnhub API client

**Files:**
- Create: `lib/finnhub.ts`
- Test: `tests/lib/finnhub.test.ts`

**Interfaces:**
- Consumes: `process.env.FINNHUB_API_KEY`, global `fetch`.
- Produces: `searchSymbol(query: string): Promise<FinnhubSymbolResult[]>`, `getQuote(symbol: string): Promise<FinnhubQuote>`, `getProfile(symbol: string): Promise<FinnhubProfile>`, `getMetrics(symbol: string): Promise<FinnhubMetrics>`, `getCompanyNews(symbol: string, fromDate: string, toDate: string): Promise<FinnhubNewsItem[]>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/finnhub.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchSymbol, getQuote, getProfile, getMetrics, getCompanyNews } from '@/lib/finnhub'

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: () => Promise.resolve(body),
    })
  )
}

describe('finnhub client', () => {
  beforeEach(() => {
    process.env.FINNHUB_API_KEY = 'test-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('searchSymbol returns matches', async () => {
    mockFetchOnce({ result: [{ symbol: 'AAPL', description: 'Apple Inc', type: 'Common Stock' }] })
    const results = await searchSymbol('AAPL')
    expect(results).toEqual([{ symbol: 'AAPL', description: 'Apple Inc', type: 'Common Stock' }])
  })

  it('getQuote maps Finnhub fields to named fields', async () => {
    mockFetchOnce({ c: 150.5, dp: 1.25, h: 152, l: 148, o: 149, pc: 148.7 })
    const quote = await getQuote('AAPL')
    expect(quote).toEqual({
      currentPrice: 150.5,
      changePercent: 1.25,
      high: 152,
      low: 148,
      open: 149,
      previousClose: 148.7,
    })
  })

  it('getProfile maps company profile fields', async () => {
    mockFetchOnce({ name: 'Apple Inc', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 3000000 })
    const profile = await getProfile('AAPL')
    expect(profile).toEqual({
      name: 'Apple Inc',
      exchange: 'NASDAQ',
      currency: 'USD',
      marketCapitalization: 3000000,
    })
  })

  it('getMetrics falls back to null for missing fields', async () => {
    mockFetchOnce({ metric: {} })
    const metrics = await getMetrics('AAPL')
    expect(metrics).toEqual({ peRatio: null, week52High: null, week52Low: null })
  })

  it('getCompanyNews maps news items', async () => {
    mockFetchOnce([
      { headline: 'Apple hits new high', url: 'https://example.com/a', source: 'Reuters', summary: 'summary', datetime: 1700000000 },
    ])
    const news = await getCompanyNews('AAPL', '2026-11-01', '2026-11-11')
    expect(news).toEqual([
      { headline: 'Apple hits new high', url: 'https://example.com/a', source: 'Reuters', summary: 'summary', datetime: 1700000000 },
    ])
  })

  it('throws a clear error when Finnhub returns a non-ok response', async () => {
    mockFetchOnce({}, false)
    await expect(getQuote('AAPL')).rejects.toThrow('Finnhub request failed: 500 /quote')
  })

  it('throws when FINNHUB_API_KEY is not set', async () => {
    delete process.env.FINNHUB_API_KEY
    mockFetchOnce({ c: 1, dp: 1, h: 1, l: 1, o: 1, pc: 1 })
    await expect(getQuote('AAPL')).rejects.toThrow('FINNHUB_API_KEY is not set')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/finnhub.test.ts`
Expected: FAIL with "Cannot find module '@/lib/finnhub'".

- [ ] **Step 3: Implement the Finnhub client**

```typescript
// lib/finnhub.ts
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'

export interface FinnhubSymbolResult {
  symbol: string
  description: string
  type: string
}

export interface FinnhubQuote {
  currentPrice: number
  changePercent: number
  high: number
  low: number
  open: number
  previousClose: number
}

export interface FinnhubProfile {
  name: string
  exchange: string
  currency: string
  marketCapitalization: number
}

export interface FinnhubMetrics {
  peRatio: number | null
  week52High: number | null
  week52Low: number | null
}

export interface FinnhubNewsItem {
  headline: string
  url: string
  source: string
  summary: string
  datetime: number
}

function apiKey(): string {
  const key = process.env.FINNHUB_API_KEY
  if (!key) throw new Error('FINNHUB_API_KEY is not set')
  return key
}

async function finnhubFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${FINNHUB_BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('token', apiKey())

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Finnhub request failed: ${res.status} ${path}`)
  }
  return res.json() as Promise<T>
}

export async function searchSymbol(query: string): Promise<FinnhubSymbolResult[]> {
  const data = await finnhubFetch<{ result: FinnhubSymbolResult[] }>('/search', { q: query })
  return data.result
}

export async function getQuote(symbol: string): Promise<FinnhubQuote> {
  const data = await finnhubFetch<{ c: number; dp: number; h: number; l: number; o: number; pc: number }>(
    '/quote',
    { symbol }
  )
  return {
    currentPrice: data.c,
    changePercent: data.dp,
    high: data.h,
    low: data.l,
    open: data.o,
    previousClose: data.pc,
  }
}

export async function getProfile(symbol: string): Promise<FinnhubProfile> {
  const data = await finnhubFetch<{
    name: string
    exchange: string
    currency: string
    marketCapitalization: number
  }>('/stock/profile2', { symbol })
  return {
    name: data.name,
    exchange: data.exchange,
    currency: data.currency,
    marketCapitalization: data.marketCapitalization,
  }
}

export async function getMetrics(symbol: string): Promise<FinnhubMetrics> {
  const data = await finnhubFetch<{ metric: Record<string, number | undefined> }>('/stock/metric', {
    symbol,
    metric: 'all',
  })
  return {
    peRatio: data.metric.peBasicExclExtraTTM ?? null,
    week52High: data.metric['52WeekHigh'] ?? null,
    week52Low: data.metric['52WeekLow'] ?? null,
  }
}

export async function getCompanyNews(symbol: string, fromDate: string, toDate: string): Promise<FinnhubNewsItem[]> {
  const data = await finnhubFetch<
    Array<{ headline: string; url: string; source: string; summary: string; datetime: number }>
  >('/company-news', { symbol, from: fromDate, to: toDate })
  return data.map((d) => ({
    headline: d.headline,
    url: d.url,
    source: d.source,
    summary: d.summary,
    datetime: d.datetime,
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/finnhub.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Finnhub API client"
```

---

### Task 4: Refresh logic

**Files:**
- Create: `lib/refresh.ts`
- Test: `tests/lib/refresh.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`, `getQuote`/`getProfile`/`getMetrics`/`getCompanyNews` from `@/lib/finnhub`.
- Produces: `refreshStock(symbol: string): Promise<RefreshResult>`, `refreshAllStocks(): Promise<RefreshResult[]>`, where `RefreshResult = { symbol: string; ok: boolean; error?: string }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/refresh.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import { resetDb } from '../helpers/db'
import { refreshStock, refreshAllStocks } from '@/lib/refresh'

describe('refreshStock', () => {
  beforeEach(resetDb)

  it('writes a price snapshot and news items for a known stock', async () => {
    const stock = await prisma.stock.create({
      data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
    })

    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 150, changePercent: 1.1, high: 151, low: 149, open: 149.5, previousClose: 148.9,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 3000000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({ peRatio: 28.5, week52High: 180, week52Low: 120 })
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([
      { headline: 'Apple news', url: 'https://example.com/n1', source: 'Reuters', summary: 's', datetime: 1700000000 },
    ])

    const result = await refreshStock('AAPL')
    expect(result).toEqual({ symbol: 'AAPL', ok: true })

    const snapshots = await prisma.priceSnapshot.findMany({ where: { stockId: stock.id } })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].price).toBe(150)

    const news = await prisma.newsItem.findMany({ where: { stockId: stock.id } })
    expect(news).toHaveLength(1)
    expect(news[0].headline).toBe('Apple news')
  })

  it('returns ok:false and does not throw when Finnhub fails', async () => {
    await prisma.stock.create({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockRejectedValue(new Error('Finnhub request failed: 429 /quote'))

    const result = await refreshStock('MSFT')
    expect(result).toEqual({ symbol: 'MSFT', ok: false, error: 'Finnhub request failed: 429 /quote' })
  })

  it('does not duplicate news items with the same url on repeated refresh', async () => {
    await prisma.stock.create({ data: { symbol: 'TSLA', name: 'Tesla', exchange: 'NASDAQ' } })
    vi.spyOn(finnhub, 'getQuote').mockResolvedValue({
      currentPrice: 200, changePercent: 0.5, high: 201, low: 199, open: 199, previousClose: 199,
    })
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({
      name: 'Tesla', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 600000,
    })
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({ peRatio: null, week52High: null, week52Low: null })
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([
      { headline: 'Tesla news', url: 'https://example.com/t1', source: 'Reuters', summary: 's', datetime: 1700000000 },
    ])

    await refreshStock('TSLA')
    await refreshStock('TSLA')

    const news = await prisma.newsItem.findMany({ where: { headline: 'Tesla news' } })
    expect(news).toHaveLength(1)
  })
})

describe('refreshAllStocks', () => {
  beforeEach(resetDb)

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
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({ peRatio: null, week52High: null, week52Low: null })
    vi.spyOn(finnhub, 'getCompanyNews').mockResolvedValue([])

    const results = await refreshAllStocks()
    expect(results).toHaveLength(2)
    expect(results.find((r) => r.symbol === 'GOOD')?.ok).toBe(true)
    expect(results.find((r) => r.symbol === 'BAD')?.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/refresh.test.ts`
Expected: FAIL with "Cannot find module '@/lib/refresh'".

- [ ] **Step 3: Implement refresh logic**

```typescript
// lib/refresh.ts
import { prisma } from './db'
import { getQuote, getProfile, getMetrics, getCompanyNews } from './finnhub'

export interface RefreshResult {
  symbol: string
  ok: boolean
  error?: string
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
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
      },
    })

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

    return { symbol, ok: true }
  } catch (err) {
    return { symbol, ok: false, error: err instanceof Error ? err.message : String(err) }
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
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add refresh logic for individual and all watchlist stocks"
```

---

### Task 5: Watchlist CRUD API routes

**Files:**
- Create: `app/api/stocks/route.ts`
- Create: `app/api/stocks/[symbol]/route.ts`
- Test: `tests/api/stocks.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`, `searchSymbol`/`getProfile` from `@/lib/finnhub`, `refreshStock` from `@/lib/refresh`.
- Produces: `GET`/`POST` handlers at `app/api/stocks/route.ts`, `GET`/`DELETE` handlers at `app/api/stocks/[symbol]/route.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/api/stocks.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import * as refreshLib from '@/lib/refresh'
import { resetDb } from '../helpers/db'
import { GET as listStocks, POST as addStock } from '@/app/api/stocks/route'
import { GET as getStock, DELETE as deleteStock } from '@/app/api/stocks/[symbol]/route'

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/stocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

describe('stocks API', () => {
  beforeEach(() => {
    resetDb()
    vi.restoreAllMocks()
  })

  it('POST adds a new stock after validating it with Finnhub', async () => {
    vi.spyOn(finnhub, 'searchSymbol').mockResolvedValue([{ symbol: 'AAPL', description: 'Apple Inc', type: 'Common Stock' }])
    vi.spyOn(finnhub, 'getProfile').mockResolvedValue({ name: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 3000000 })
    vi.spyOn(refreshLib, 'refreshStock').mockResolvedValue({ symbol: 'AAPL', ok: true })

    const res = await addStock(jsonRequest({ symbol: 'aapl' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.stock.symbol).toBe('AAPL')

    const stored = await prisma.stock.findUnique({ where: { symbol: 'AAPL' } })
    expect(stored).not.toBeNull()
  })

  it('POST returns 404 for an unknown symbol instead of creating a row', async () => {
    vi.spyOn(finnhub, 'searchSymbol').mockResolvedValue([])

    const res = await addStock(jsonRequest({ symbol: 'ZZZZZ' }))
    expect(res.status).toBe(404)

    const stored = await prisma.stock.findUnique({ where: { symbol: 'ZZZZZ' } })
    expect(stored).toBeNull()
  })

  it('POST returns 409 when the symbol is already in the watchlist', async () => {
    await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })

    const res = await addStock(jsonRequest({ symbol: 'AAPL' }))
    expect(res.status).toBe(409)
  })

  it('GET /api/stocks lists stocks with their latest snapshot', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 150, changePct: 1 } })

    const res = await listStocks()
    const body = await res.json()
    expect(body.stocks).toHaveLength(1)
    expect(body.stocks[0].snapshots).toHaveLength(1)
  })

  it('DELETE removes a stock and cascades its snapshots', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 150, changePct: 1 } })

    const res = await deleteStock(new Request('http://localhost/api/stocks/AAPL') as any, { params: { symbol: 'AAPL' } })
    expect(res.status).toBe(200)

    const stored = await prisma.stock.findUnique({ where: { symbol: 'AAPL' } })
    expect(stored).toBeNull()
    const snapshots = await prisma.priceSnapshot.findMany({ where: { stockId: stock.id } })
    expect(snapshots).toHaveLength(0)
  })

  it('DELETE returns 404 for a symbol not in the watchlist', async () => {
    const res = await deleteStock(new Request('http://localhost/api/stocks/NOPE') as any, { params: { symbol: 'NOPE' } })
    expect(res.status).toBe(404)
  })

  it('GET detail returns 404 for a symbol not in the watchlist', async () => {
    const res = await getStock(new Request('http://localhost/api/stocks/NOPE') as any, { params: { symbol: 'NOPE' } })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/stocks.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/stocks/route'".

- [ ] **Step 3: Implement `app/api/stocks/route.ts`**

```typescript
// app/api/stocks/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { searchSymbol, getProfile } from '@/lib/finnhub'
import { refreshStock } from '@/lib/refresh'

export async function GET() {
  const stocks = await prisma.stock.findMany({
    orderBy: { addedAt: 'asc' },
    include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 1 } },
  })
  return NextResponse.json({ stocks })
}

export async function POST(request: Request) {
  const body = await request.json()
  const symbol = typeof body.symbol === 'string' ? body.symbol.toUpperCase().trim() : ''

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }

  const existing = await prisma.stock.findUnique({ where: { symbol } })
  if (existing) {
    return NextResponse.json({ error: `${symbol} is already in the watchlist` }, { status: 409 })
  }

  const matches = await searchSymbol(symbol)
  const match = matches.find((m) => m.symbol === symbol)
  if (!match) {
    return NextResponse.json({ error: `No symbol found for "${symbol}"` }, { status: 404 })
  }

  const profile = await getProfile(symbol)

  const stock = await prisma.stock.create({
    data: {
      symbol,
      name: profile.name || match.description,
      exchange: profile.exchange,
    },
  })

  await refreshStock(symbol)

  return NextResponse.json({ stock }, { status: 201 })
}
```

- [ ] **Step 4: Implement `app/api/stocks/[symbol]/route.ts`**

```typescript
// app/api/stocks/[symbol]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase()
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 100 },
      news: { orderBy: { publishedAt: 'desc' }, take: 20 },
    },
  })

  if (!stock) {
    return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })
  }

  return NextResponse.json({ stock })
}

export async function DELETE(_request: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase()
  const stock = await prisma.stock.findUnique({ where: { symbol } })

  if (!stock) {
    return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })
  }

  await prisma.stock.delete({ where: { symbol } })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/api/stocks.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add watchlist CRUD API routes"
```

---

### Task 6: Manual refresh and cron refresh API routes

**Files:**
- Create: `app/api/stocks/[symbol]/refresh/route.ts`
- Create: `app/api/cron/refresh/route.ts`
- Create: `vercel.json`
- Test: `tests/api/refresh.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`, `refreshStock`/`refreshAllStocks` from `@/lib/refresh`, `process.env.CRON_SECRET`.
- Produces: `POST` handler at `app/api/stocks/[symbol]/refresh/route.ts`, `GET` handler at `app/api/cron/refresh/route.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/api/refresh.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as refreshLib from '@/lib/refresh'
import { resetDb } from '../helpers/db'
import { POST as manualRefresh } from '@/app/api/stocks/[symbol]/refresh/route'
import { GET as cronRefresh } from '@/app/api/cron/refresh/route'

describe('manual refresh route', () => {
  beforeEach(() => {
    resetDb()
    vi.restoreAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('returns 404 for a symbol not in the watchlist', async () => {
    const res = await manualRefresh(new Request('http://localhost') as any, { params: { symbol: 'NOPE' } })
    expect(res.status).toBe(404)
  })

  it('returns 502 when refresh fails', async () => {
    await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    vi.spyOn(refreshLib, 'refreshStock').mockResolvedValue({ symbol: 'AAPL', ok: false, error: 'Finnhub request failed: 429 /quote' })

    const res = await manualRefresh(new Request('http://localhost') as any, { params: { symbol: 'AAPL' } })
    expect(res.status).toBe(502)
  })

  it('returns 200 when refresh succeeds', async () => {
    await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    vi.spyOn(refreshLib, 'refreshStock').mockResolvedValue({ symbol: 'AAPL', ok: true })

    const res = await manualRefresh(new Request('http://localhost') as any, { params: { symbol: 'AAPL' } })
    expect(res.status).toBe(200)
  })
})

describe('cron refresh route', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('rejects requests without the correct bearer token', async () => {
    const res = await cronRefresh(new Request('http://localhost', { headers: { authorization: 'Bearer wrong' } }) as any)
    expect(res.status).toBe(401)
  })

  it('refreshes all stocks and reports per-symbol results when authorized', async () => {
    vi.spyOn(refreshLib, 'refreshAllStocks').mockResolvedValue([
      { symbol: 'GOOD', ok: true },
      { symbol: 'BAD', ok: false, error: 'Finnhub request failed: 429 /quote' },
    ])

    const res = await cronRefresh(new Request('http://localhost', { headers: { authorization: 'Bearer test-secret' } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refreshed).toBe(2)
    expect(body.failed).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/refresh.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/stocks/[symbol]/refresh/route'".

- [ ] **Step 3: Implement manual refresh route**

```typescript
// app/api/stocks/[symbol]/refresh/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { refreshStock } from '@/lib/refresh'

export async function POST(_request: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase()
  const stock = await prisma.stock.findUnique({ where: { symbol } })

  if (!stock) {
    return NextResponse.json({ error: `${symbol} is not in the watchlist` }, { status: 404 })
  }

  const result = await refreshStock(symbol)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Implement cron refresh route**

Vercel Cron sends a `GET` request and, when a project's `CRON_SECRET` env
var is set, automatically adds `Authorization: Bearer <CRON_SECRET>` —
this route must accept `GET`, not `POST`, to match that behavior.

```typescript
// app/api/cron/refresh/route.ts
import { NextResponse } from 'next/server'
import { refreshAllStocks } from '@/lib/refresh'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const results = await refreshAllStocks()
  const failed = results.filter((r) => !r.ok)

  return NextResponse.json({ refreshed: results.length, failed: failed.length, results })
}
```

- [ ] **Step 5: Add Vercel Cron schedule**

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/refresh",
      "schedule": "*/30 * * * *"
    }
  ]
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/api/refresh.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add manual and scheduled refresh routes"
```

---

### Task 7: Watchlist page UI

**Files:**
- Modify: `app/page.tsx`
- Create: `components/AddStockForm.tsx`
- Test: `tests/components/AddStockForm.test.tsx`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db` (server component), `POST /api/stocks` (client component fetch).
- Produces: `AddStockForm` component (default export not required; named export `AddStockForm`), rendered watchlist page at `/`.

- [ ] **Step 1: Write the failing test for `AddStockForm`**

```typescript
// tests/components/AddStockForm.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddStockForm } from '@/components/AddStockForm'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

describe('AddStockForm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('submits the typed symbol to POST /api/stocks', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ stock: { symbol: 'AAPL' } }) })

    render(<AddStockForm />)
    fireEvent.change(screen.getByPlaceholderText(/symbol/i), { target: { value: 'aapl' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/stocks', expect.objectContaining({ method: 'POST' })))
  })

  it('shows an inline error message when the API rejects the symbol', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'No symbol found for "ZZZZZ"' }) })

    render(<AddStockForm />)
    fireEvent.change(screen.getByPlaceholderText(/symbol/i), { target: { value: 'ZZZZZ' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No symbol found for "ZZZZZ"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/AddStockForm.test.tsx`
Expected: FAIL with "Cannot find module '@/components/AddStockForm'".

- [ ] **Step 3: Implement `AddStockForm`**

```tsx
// components/AddStockForm.tsx
'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export function AddStockForm() {
  const router = useRouter()
  const [symbol, setSymbol] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    })

    setSubmitting(false)

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to add symbol')
      return
    }

    setSymbol('')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        placeholder="Symbol (e.g. AAPL)"
        disabled={submitting}
      />
      <button type="submit" disabled={submitting || !symbol.trim()}>
        Add
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/components/AddStockForm.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement the watchlist page**

```tsx
// app/page.tsx
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { AddStockForm } from '@/components/AddStockForm'

export const dynamic = 'force-dynamic'

export default async function WatchlistPage() {
  const stocks = await prisma.stock.findMany({
    orderBy: { addedAt: 'asc' },
    include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 1 } },
  })

  return (
    <main>
      <h1>Watchlist</h1>
      <AddStockForm />
      {stocks.length === 0 ? (
        <p>No stocks yet. Add a symbol above to get started.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th>Price</th>
              <th>Change %</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((stock) => {
              const latest = stock.snapshots[0]
              return (
                <tr key={stock.id}>
                  <td>
                    <Link href={`/stock/${stock.symbol}`}>{stock.symbol}</Link>
                  </td>
                  <td>{stock.name}</td>
                  <td>{latest ? `$${latest.price.toFixed(2)}` : '—'}</td>
                  <td>{latest ? `${latest.changePct.toFixed(2)}%` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </main>
  )
}
```

This satisfies the empty-watchlist Review Focus item directly: zero
stocks renders the "No stocks yet" message instead of an empty table.

- [ ] **Step 6: Verify manually**

Run: `npm run dev`, open `http://localhost:3000`.
Expected: page loads showing "No stocks yet" (DB is empty at this point) and the add-stock form.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add watchlist page with add-stock form"
```

---

### Task 8: Stock detail page UI

**Files:**
- Create: `app/stock/[symbol]/page.tsx`
- Create: `components/PriceChart.tsx`
- Create: `components/NewsList.tsx`
- Test: `tests/components/PriceChart.test.tsx`
- Test: `tests/components/NewsList.test.tsx`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db` (server component).
- Produces: `PriceChart({ snapshots: { price: number; timestamp: Date }[] })`, `NewsList({ news: { id: string; headline: string; url: string; source: string; publishedAt: Date }[] })`, detail page at `/stock/[symbol]`.

- [ ] **Step 1: Write the failing tests for `PriceChart`**

```typescript
// tests/components/PriceChart.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriceChart } from '@/components/PriceChart'

describe('PriceChart', () => {
  it('renders a message instead of a chart when there is no history', () => {
    render(<PriceChart snapshots={[]} />)
    expect(screen.getByText(/no price history yet/i)).toBeInTheDocument()
  })

  it('renders a single-point message when there is exactly one snapshot', () => {
    render(<PriceChart snapshots={[{ price: 100, timestamp: new Date() }]} />)
    expect(screen.getByText(/only one data point/i)).toBeInTheDocument()
  })

  it('renders an svg chart when there are multiple snapshots', () => {
    render(
      <PriceChart
        snapshots={[
          { price: 100, timestamp: new Date('2026-11-01') },
          { price: 110, timestamp: new Date('2026-11-02') },
        ]}
      />
    )
    expect(screen.getByRole('img', { name: /price history chart/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Write the failing test for `NewsList`**

```typescript
// tests/components/NewsList.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NewsList } from '@/components/NewsList'

describe('NewsList', () => {
  it('renders a fallback message when there is no news', () => {
    render(<NewsList news={[]} />)
    expect(screen.getByText(/no recent news/i)).toBeInTheDocument()
  })

  it('renders each news item as a link', () => {
    render(
      <NewsList
        news={[
          { id: '1', headline: 'Apple hits new high', url: 'https://example.com/a', source: 'Reuters', publishedAt: new Date('2026-11-01') },
        ]}
      />
    )
    expect(screen.getByRole('link', { name: /apple hits new high/i })).toHaveAttribute('href', 'https://example.com/a')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/components/PriceChart.test.tsx tests/components/NewsList.test.tsx`
Expected: FAIL with "Cannot find module '@/components/PriceChart'" and "'@/components/NewsList'".

- [ ] **Step 4: Implement `PriceChart`**

```tsx
// components/PriceChart.tsx
interface Snapshot {
  price: number
  timestamp: Date
}

export function PriceChart({ snapshots }: { snapshots: Snapshot[] }) {
  if (snapshots.length === 0) {
    return <p>No price history yet.</p>
  }

  if (snapshots.length === 1) {
    return <p>Only one data point so far: ${snapshots[0].price.toFixed(2)}</p>
  }

  const ordered = [...snapshots].reverse()
  const prices = ordered.map((s) => s.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1

  const width = 300
  const height = 80
  const points = ordered
    .map((s, i) => {
      const x = (i / (ordered.length - 1)) * width
      const y = height - ((s.price - min) / range) * height
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} role="img" aria-label="Price history chart">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  )
}
```

- [ ] **Step 5: Implement `NewsList`**

```tsx
// components/NewsList.tsx
interface NewsItemProps {
  id: string
  headline: string
  url: string
  source: string
  publishedAt: Date
}

export function NewsList({ news }: { news: NewsItemProps[] }) {
  if (news.length === 0) {
    return <p>No recent news.</p>
  }

  return (
    <ul>
      {news.map((item) => (
        <li key={item.id}>
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {item.headline}
          </a>{' '}
          — {item.source} ({item.publishedAt.toLocaleDateString()})
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/components/PriceChart.test.tsx tests/components/NewsList.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 7: Implement the detail page**

```tsx
// app/stock/[symbol]/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { PriceChart } from '@/components/PriceChart'
import { NewsList } from '@/components/NewsList'

export const dynamic = 'force-dynamic'

export default async function StockDetailPage({ params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase()
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 100 },
      news: { orderBy: { publishedAt: 'desc' }, take: 20 },
    },
  })

  if (!stock) {
    notFound()
  }

  const latest = stock.snapshots[0]

  return (
    <main>
      <h1>
        {stock.symbol} — {stock.name}
      </h1>
      {latest ? (
        <section>
          <p>
            Price: ${latest.price.toFixed(2)} ({latest.changePct.toFixed(2)}%)
          </p>
          <p>P/E: {latest.peRatio ?? '—'}</p>
          <p>Market cap: {latest.marketCap ?? '—'}</p>
          <p>
            52w range: {latest.week52Low ?? '—'} – {latest.week52High ?? '—'}
          </p>
          <p>Updated at {latest.timestamp.toLocaleString()}</p>
        </section>
      ) : (
        <p>No data yet. Refresh to fetch the latest snapshot.</p>
      )}
      <PriceChart snapshots={stock.snapshots} />
      <section>
        <h2>Considerations</h2>
        <p>Valuation and buy/sell signals are not implemented yet.</p>
      </section>
      <NewsList news={stock.news} />
    </main>
  )
}
```

- [ ] **Step 8: Verify manually**

Run: `npm run dev`, use the watchlist form to add `AAPL`, then open
`http://localhost:3000/stock/AAPL`.
Expected: detail page shows price, metrics, an empty "Considerations"
placeholder, and recent news (or "No recent news." if Finnhub's test
API key returns none).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add stock detail page with price chart and news list"
```

---

### Task 9: Deployment

**Files:**
- Modify: `README.md` (create if absent)
- Modify: `.env.example` (confirm all vars documented — already done in Task 1)

**Interfaces:**
- Produces: a live Vercel deployment serving the app, backed by a Neon Postgres database, with Vercel Cron configured.

- [ ] **Step 1: Create a Neon Postgres database**

Via the Neon dashboard (or `npx neonctl`), create a project named
`any-stock` and copy its connection string.

- [ ] **Step 2: Run the production migration against Neon**

```bash
DATABASE_URL="<neon-connection-string>" npx prisma migrate deploy
```
Expected: `Stock`, `PriceSnapshot`, `NewsItem` tables created in the Neon database.

- [ ] **Step 3: Create the Vercel project and set environment variables**

```bash
npx vercel link
npx vercel env add DATABASE_URL production
npx vercel env add FINNHUB_API_KEY production
npx vercel env add CRON_SECRET production
```

- [ ] **Step 4: Deploy**

```bash
npx vercel --prod
```
Expected: deployment succeeds, Vercel prints a production URL.

- [ ] **Step 5: Verify the deployed app end to end**

Open the production URL, add a real symbol (e.g. `AAPL`) through the
UI, confirm the watchlist and detail page both show live data within a
few seconds.

- [ ] **Step 6: Verify the cron job is registered**

Check the Vercel dashboard's Cron Jobs tab for the project: confirm
`/api/cron/refresh` is listed with schedule `*/30 * * * *`.

- [ ] **Step 7: Write a short README**

```markdown
# Any-Stock

Personal watchlist app: price, key metrics, and recent news for a small
set of stocks, backed by Finnhub.

## Local development

1. `docker compose -f docker-compose.test.yml up -d`
2. Copy `.env.example` to `.env` and `.env.test`, fill in `FINNHUB_API_KEY`
3. `npx prisma migrate dev`
4. `npm run dev`

## Testing

`npm test` (requires the test Postgres container running)

## Deployment

See `docs/superpowers/plans/2026-11-11-any-stock-mvp.md`, Task 9.
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: add README with local dev and deployment instructions"
```

---

## Self-Review Notes

**Spec coverage:** Architecture (Tasks 1–2), data model (Task 2), pages
(Tasks 7–8), API routes (Tasks 5–6), data refresh (Task 6), error
handling (Tasks 4, 6 — stale data via DB reads in Tasks 7–8), testing
(all tasks), deployment (Task 9). Non-goals (valuation, forecaster.biz,
auth, notifications) are explicitly not implemented anywhere in this
plan, matching the spec.

**Placeholder scan:** none found — every step has runnable code or an
exact command.

**Type consistency:** `RefreshResult`, `FinnhubQuote`, `FinnhubProfile`,
`FinnhubMetrics`, `FinnhubNewsItem` are defined once in Task 3/4 and
reused with identical shapes in Tasks 5–6 tests. `PriceSnapshot`/`NewsItem`
field names match between `prisma/schema.prisma` (Task 2) and every
later read/write (Tasks 4–8).

**Review Focus:** all five items have an owning task and test, listed
in the Review Focus section above.
