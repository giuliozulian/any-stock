# EDGAR Form 4 Insider Cluster Discovery Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/scopri` discover US stocks purely from insider-cluster activity (≥2 distinct insiders filing an open-market purchase in the most recent SEC Form 4 filings market-wide), even when the stock is not a mover and has no Congress activity.

**Architecture:** A new standalone module (`lib/edgar-form4-feed.ts`) reads EDGAR's "getcurrent" Form 4 Atom feed (market-wide, last ~100 filings, no per-ticker looping), resolves each filer's CIK to a ticker via the existing SEC ticker cache, fetches each filing's XML to find purchase transactions, and groups by symbol into cluster counts. `lib/discover.ts` gets one new seed-sourcing block (same try/catch-isolated pattern as its three existing sources) and a reserved-slot tweak to `selectForEnrichment` so cluster-only candidates cannot be crowded out by movers. No change to scoring: Finnhub's existing per-candidate insider enrichment already produces the score once a symbol becomes a candidate.

**Tech Stack:** TypeScript, Vitest, Prisma (test DB via `resetDb()`), raw `fetch` against `sec.gov` (same `User-Agent` convention as `lib/edgar-roles.ts`).

**Spec:** `docs/superpowers/specs/2026-11-14-edgar-form4-cluster-design.md`

## Global Constraints

- Feed size fixed at **100** most recent Form 4 filings per scan (`limit = 100` default).
- Cluster threshold fixed at **≥2** distinct insiders with a purchase (`minBuyers = 2` default).
- Reserved slots for cluster-only candidates: **4**, carved out of `maxUS` (default 14 → 10 general + 4 reserved). Unused reserved slots are **not** given back to movers/congress (same principle as the existing fixed IT quota).
- No cron, no new page, no new DB table, no changes to `scoreCandidate`/`ScoreInput`/`buildReason` — this plan only changes *sourcing* (`sourceCandidates`, `selectForEnrichment`) and adds one new leaf module.
- No new heuristics beyond the raw cluster count (no "first buy in a year", no 10b5-1 exclusion, etc.) — v1 minimal, per spec non-goals.
- SEC requests use `User-Agent: 'any-stock/1.0 (personal watchlist app)'` and `AbortSignal.timeout(10000)`, matching `lib/edgar-roles.ts`.
- The `company_tickers.json` ticker↔CIK cache is shared with `lib/edgar-roles.ts` (24h TTL, one underlying fetch) — do not add a second independent fetch of that file.
- `app/api/discover/route.ts` already sets `maxDuration = 60`; this plan adds network calls to the same budget (verified manually in the final task, no code change expected).

## Review Focus

- A Form 4 with multiple transaction rows (e.g. a sale listed first, a purchase listed second in the same filing) must count as a purchase if *any* row is code `P`, not just the first row in the document.
- Two filings spelling the same insider's name differently (case, spacing, order) are counted as two distinct buyers in v1 — this is a known, accepted limitation, not a silent surprise, and must be pinned by a test.
- A single failed fetch (the feed itself, or one filing's XML) must never zero out or block the cluster count for the other symbols in the same batch.
- A CIK with no mapped ticker (fund, 13F-only filer, foreign issuer not in `company_tickers.json`) must be silently dropped, never crash the scan.
- On a day with zero cluster-only candidates, `selectForEnrichment` must return exactly today's behavior (full `maxUS` from movers/congress) — the 4-slot reservation only activates when there is something to protect.

---

## Task 1: `getTickerByCik` in `lib/edgar-roles.ts`

**Files:**
- Modify: `lib/edgar-roles.ts:1-18` (the `tickerMap` cache and `getCik`)
- Test: `tests/lib/edgar-roles.test.ts`

**Interfaces:**
- Produces: `export async function getTickerByCik(cik: number): Promise<string | null>` — used by Task 4.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/edgar-roles.test.ts` (new `describe` block, needs `vi` and a `fetch` stub since this hits the network path):

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { parseRole, getTickerByCik } from '@/lib/edgar-roles'

describe('getTickerByCik', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
          1: { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corp' },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('resolves a ticker from a CIK using the same company_tickers.json cache as getCik', async () => {
    expect(await getTickerByCik(320193)).toBe('AAPL')
    expect(await getTickerByCik(789019)).toBe('MSFT')
  })

  it('returns null for an unmapped CIK', async () => {
    expect(await getTickerByCik(999999999)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/edgar-roles.test.ts -t getTickerByCik`
Expected: FAIL — `getTickerByCik is not a function` (not exported yet).

- [ ] **Step 3: Implement**

Replace the top of `lib/edgar-roles.ts` (lines 1-18) with:

```typescript
const TTL_MS = 24 * 60 * 60 * 1000
const UA = 'any-stock/1.0 (personal watchlist app)'
const roleCache = new Map<string, { at: number; roles: Record<string, string | null> }>()
let tickerMap: { at: number; map: Map<string, number>; byCik: Map<number, string> } | null = null

async function secJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`SEC ${res.status}`)
  return (await res.json()) as T
}

async function ensureTickerMap(): Promise<{ map: Map<string, number>; byCik: Map<number, string> }> {
  if (!tickerMap || Date.now() - tickerMap.at > TTL_MS) {
    const data = await secJson<Record<string, { cik_str: number; ticker: string }>>('https://www.sec.gov/files/company_tickers.json')
    const entries = Object.values(data)
    tickerMap = {
      at: Date.now(),
      map: new Map(entries.map((v) => [v.ticker.toUpperCase(), v.cik_str])),
      byCik: new Map(entries.map((v) => [v.cik_str, v.ticker.toUpperCase()])),
    }
  }
  return tickerMap
}

async function getCik(symbol: string): Promise<number | null> {
  const { map } = await ensureTickerMap()
  return map.get(symbol.toUpperCase()) ?? null
}

// Ticker for a CIK, from the same SEC company_tickers.json cache getCik uses. Null when the filer has no mapped ticker (fund, 13F-only filer, foreign issuer not covered by the file).
export async function getTickerByCik(cik: number): Promise<string | null> {
  const { byCik } = await ensureTickerMap()
  return byCik.get(cik) ?? null
}
```

Leave the rest of the file (`parseRole`, `getInsiderRoles`) untouched — `getCik`'s behavior and signature are unchanged, only its internals now go through the shared `ensureTickerMap`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/edgar-roles.test.ts`
Expected: PASS (all tests, including the pre-existing `parseRole` ones).

- [ ] **Step 5: Commit**

```bash
git add lib/edgar-roles.ts tests/lib/edgar-roles.test.ts
git commit -m "feat: add getTickerByCik to edgar-roles, reusing the ticker cache"
```

---

## Task 2: `parseFeedEntries` in new `lib/edgar-form4-feed.ts`

**Files:**
- Create: `lib/edgar-form4-feed.ts`
- Test: `tests/lib/edgar-form4-feed.test.ts`

**Interfaces:**
- Produces: `interface Form4FeedEntry { cik: number; companyName: string; accessionNumber: string }`, `export function parseFeedEntries(atomXml: string): Form4FeedEntry[]` — used by Task 4.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/edgar-form4-feed.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { parseFeedEntries } from '@/lib/edgar-form4-feed'

const ATOM_SAMPLE = `<?xml version="1.0" encoding="ISO-8859-1"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
<title>4 - AAA INC (0000000001) (Reporting)</title>
<id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000001</id>
</entry>
<entry>
<title>4 - BBB CORP (0000000002) (Reporting)</title>
<id>urn:tag:sec.gov,2008:accession-number=0000000002-26-000001</id>
</entry>
</feed>`

describe('parseFeedEntries', () => {
  it('extracts cik, company name and accession number from each entry', () => {
    const entries = parseFeedEntries(ATOM_SAMPLE)
    expect(entries).toEqual([
      { cik: 1, companyName: 'AAA INC', accessionNumber: '0000000001-26-000001' },
      { cik: 2, companyName: 'BBB CORP', accessionNumber: '0000000002-26-000001' },
    ])
  })

  it('skips an entry with no parseable title or accession number', () => {
    const broken = `<feed><entry><title>garbage</title></entry></feed>`
    expect(parseFeedEntries(broken)).toEqual([])
  })

  it('returns an empty array for a feed with no entries', () => {
    expect(parseFeedEntries('<feed></feed>')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/edgar-form4-feed.test.ts`
Expected: FAIL — module `@/lib/edgar-form4-feed` does not exist.

- [ ] **Step 3: Implement**

Create `lib/edgar-form4-feed.ts`:

```typescript
export interface Form4FeedEntry {
  cik: number
  companyName: string
  accessionNumber: string
}

// One <entry> of the EDGAR "getcurrent" Atom feed, e.g.:
// <title>4 - AAA INC (0000000001) (Reporting)</title>
// <id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000001</id>
export function parseFeedEntries(atomXml: string): Form4FeedEntry[] {
  const entries: Form4FeedEntry[] = []
  const blocks = atomXml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []
  for (const block of blocks) {
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]
    const accessionNumber = block.match(/accession-number=([\d-]+)/)?.[1]
    const cikMatch = title?.match(/\((\d+)\)/)
    if (!title || !accessionNumber || !cikMatch) continue
    const companyName = title
      .replace(/^\d+\s*-\s*/, '')
      .replace(/\s*\(\d+\).*$/, '')
      .trim()
    entries.push({ cik: Number(cikMatch[1]), companyName, accessionNumber })
  }
  return entries
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/edgar-form4-feed.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/edgar-form4-feed.ts tests/lib/edgar-form4-feed.test.ts
git commit -m "feat: parse EDGAR getcurrent Form4 feed entries"
```

---

## Task 3: `parseForm4Transaction` in `lib/edgar-form4-feed.ts`

**Files:**
- Modify: `lib/edgar-form4-feed.ts`
- Test: `tests/lib/edgar-form4-feed.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `interface Form4Transaction { insiderName: string; code: string }`, `export function parseForm4Transaction(xml: string): Form4Transaction | null` — used by Task 4.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/edgar-form4-feed.test.ts`:

```typescript
import { parseForm4Transaction } from '@/lib/edgar-form4-feed'

const form4Xml = (ownerName: string, codes: string[]) => `
<ownershipDocument>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>1</rptOwnerCik><rptOwnerName>${ownerName}</rptOwnerName></reportingOwnerId>
  </reportingOwner>
  <nonDerivativeTable>
    ${codes.map((c) => `<nonDerivativeTransaction><transactionCoding><transactionCode>${c}</transactionCode></transactionCoding></nonDerivativeTransaction>`).join('\n')}
  </nonDerivativeTable>
</ownershipDocument>`

describe('parseForm4Transaction', () => {
  it('reads the owner name and a single purchase code', () => {
    expect(parseForm4Transaction(form4Xml('Jane Doe', ['P']))).toEqual({ insiderName: 'Jane Doe', code: 'P' })
  })

  it('reads a single sale code', () => {
    expect(parseForm4Transaction(form4Xml('Jane Doe', ['S']))).toEqual({ insiderName: 'Jane Doe', code: 'S' })
  })

  it('treats the filing as a purchase if ANY transaction row is code P, even if a sale is listed first', () => {
    expect(parseForm4Transaction(form4Xml('Jane Doe', ['S', 'P']))).toEqual({ insiderName: 'Jane Doe', code: 'P' })
  })

  it('returns null when there is no owner name', () => {
    expect(parseForm4Transaction('<ownershipDocument><nonDerivativeTable></nonDerivativeTable></ownershipDocument>')).toBeNull()
  })

  it('returns null when there is no transaction row at all', () => {
    expect(parseForm4Transaction('<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Jane Doe</rptOwnerName></reportingOwnerId></reportingOwner></ownershipDocument>')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/edgar-form4-feed.test.ts -t parseForm4Transaction`
Expected: FAIL — `parseForm4Transaction` is not exported.

- [ ] **Step 3: Implement**

Append to `lib/edgar-form4-feed.ts`:

```typescript
export interface Form4Transaction {
  insiderName: string
  code: string
}

// Owner name and transaction code(s) of a Form 4. A filing with several rows (e.g. a sale and a purchase in the same document) is treated as a purchase if ANY row is code P — reading only the first row would miss real purchases that happen to be listed second.
export function parseForm4Transaction(xml: string): Form4Transaction | null {
  const insiderName = xml.match(/<rptOwnerName>([^<]*)<\/rptOwnerName>/)?.[1]?.trim()
  if (!insiderName) return null
  const codes = [...xml.matchAll(/<nonDerivativeTransaction>[\s\S]*?<transactionCode>([^<]*)<\/transactionCode>/g)].map((m) => m[1]?.trim()).filter((c): c is string => Boolean(c))
  if (codes.length === 0) return null
  return { insiderName, code: codes.includes('P') ? 'P' : codes[0] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/edgar-form4-feed.test.ts`
Expected: PASS (8 tests total: 3 from Task 2 + 5 here).

- [ ] **Step 5: Commit**

```bash
git add lib/edgar-form4-feed.ts tests/lib/edgar-form4-feed.test.ts
git commit -m "feat: parse Form4 transaction codes, preferring a purchase row"
```

---

## Task 4: `getForm4ClusterSeeds` orchestration

**Files:**
- Modify: `lib/edgar-form4-feed.ts`
- Test: `tests/lib/edgar-form4-feed.test.ts`

**Interfaces:**
- Consumes: `getTickerByCik` from `@/lib/edgar-roles` (Task 1), `parseFeedEntries`/`parseForm4Transaction` (Tasks 2-3).
- Produces: `interface Form4ClusterSeed { symbol: string; name: string; buyerCount: number }`, `export async function getForm4ClusterSeeds(limit = 100, minBuyers = 2): Promise<Form4ClusterSeed[]>` — used by Task 5.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/edgar-form4-feed.test.ts`:

```typescript
import { vi, beforeEach, afterEach } from 'vitest'
import { getForm4ClusterSeeds } from '@/lib/edgar-form4-feed'
import * as edgarRoles from '@/lib/edgar-roles'

describe('getForm4ClusterSeeds', () => {
  const originalFetch = global.fetch
  const FEED = `<feed>
    <entry><title>4 - AAA INC (0000000001) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000001</id></entry>
    <entry><title>4 - AAA INC (0000000001) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000002</id></entry>
    <entry><title>4 - AAA INC (0000000001) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000003</id></entry>
    <entry><title>4 - BBB CORP (0000000002) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000002-26-000001</id></entry>
    <entry><title>4 - UNMAPPED LLC (0000000003) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000003-26-000001</id></entry>
  </feed>`
  const xmlFor = (name: string, code: string) =>
    `<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>${name}</rptOwnerName></reportingOwnerId></reportingOwner><nonDerivativeTable><nonDerivativeTransaction><transactionCoding><transactionCode>${code}</transactionCode></transactionCoding></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`

  beforeEach(() => {
    vi.spyOn(edgarRoles, 'getTickerByCik').mockImplementation(async (cik) => ({ 1: 'AAA', 2: 'BBB' }[cik] ?? null))
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('getcurrent')) return new Response(FEED, { status: 200 })
      if (url.includes('0000000001-26-000001')) return new Response(xmlFor('Jane Doe', 'P'), { status: 200 })
      if (url.includes('0000000001-26-000002')) return new Response(xmlFor('John Roe', 'P'), { status: 200 })
      if (url.includes('0000000001-26-000003')) throw new Error('network blip')
      if (url.includes('0000000002-26-000001')) return new Response(xmlFor('Solo Buyer', 'P'), { status: 200 })
      throw new Error(`unexpected URL in test: ${url}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('groups distinct purchasers by symbol and keeps only symbols at or above minBuyers', async () => {
    const seeds = await getForm4ClusterSeeds(100, 2)
    expect(seeds).toEqual([{ symbol: 'AAA', name: 'AAA INC', buyerCount: 2 }])
  })

  it('never calls fetch for a CIK with no mapped ticker', async () => {
    await getForm4ClusterSeeds(100, 2)
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('0000000003'), expect.anything())
  })

  it('a single failed filing fetch does not affect the count for other filings of the same symbol', async () => {
    // AAA has 3 entries, one throws (accession ...000003); the other two (Jane, John) must still count.
    const seeds = await getForm4ClusterSeeds(100, 2)
    expect(seeds.find((s) => s.symbol === 'AAA')?.buyerCount).toBe(2)
  })

  it('returns an empty array when the feed itself fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('SEC down')
    }) as unknown as typeof fetch
    expect(await getForm4ClusterSeeds(100, 2)).toEqual([])
  })

  it('documents a known v1 limitation: the same insider spelled differently across filings counts as two distinct buyers', async () => {
    vi.spyOn(edgarRoles, 'getTickerByCik').mockResolvedValue('AAA')
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('getcurrent')) {
        return new Response(
          `<feed>
            <entry><title>4 - AAA INC (0000000001) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000010</id></entry>
            <entry><title>4 - AAA INC (0000000001) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000011</id></entry>
          </feed>`,
          { status: 200 },
        )
      }
      if (url.includes('000010')) return new Response(xmlFor('Jane Doe', 'P'), { status: 200 })
      if (url.includes('000011')) return new Response(xmlFor('JANE DOE', 'P'), { status: 200 })
      throw new Error(`unexpected URL in test: ${url}`)
    }) as unknown as typeof fetch

    // Same real person, different capitalization — v1 has no name normalization, so this is counted as 2, not 1.
    const seeds = await getForm4ClusterSeeds(100, 2)
    expect(seeds).toEqual([{ symbol: 'AAA', name: 'AAA INC', buyerCount: 2 }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/edgar-form4-feed.test.ts -t getForm4ClusterSeeds`
Expected: FAIL — `getForm4ClusterSeeds` is not exported.

- [ ] **Step 3: Implement**

Append to `lib/edgar-form4-feed.ts`:

```typescript
import { getTickerByCik } from './edgar-roles'

const UA = 'any-stock/1.0 (personal watchlist app)'

export interface Form4ClusterSeed {
  symbol: string
  name: string
  buyerCount: number
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`SEC ${res.status}`)
  return res.text()
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

// Market-wide insider-cluster seeds: symbols with at least `minBuyers` distinct insiders filing an open-market purchase (code P) among the `limit` most recent Form 4 filings on EDGAR, across every company — not just symbols already tracked elsewhere. Returns [] when the feed itself is unreachable; one bad filing is skipped without affecting the others.
export async function getForm4ClusterSeeds(limit = 100, minBuyers = 2): Promise<Form4ClusterSeed[]> {
  let atomXml: string
  try {
    atomXml = await fetchText(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=${limit}&output=atom`)
  } catch (err) {
    console.error('Form4 cluster feed failed:', err instanceof Error ? err.message : String(err))
    return []
  }
  const entries = parseFeedEntries(atomXml)

  const bySymbol = new Map<string, { name: string; buyers: Set<string> }>()
  await runWithConcurrency(entries, 5, async (entry) => {
    const symbol = await getTickerByCik(entry.cik).catch(() => null)
    if (!symbol) return
    let xml: string
    try {
      xml = await fetchText(`https://www.sec.gov/Archives/edgar/data/${entry.cik}/${entry.accessionNumber.replace(/-/g, '')}/primary_doc.xml`)
    } catch {
      return
    }
    const transaction = parseForm4Transaction(xml)
    if (!transaction || transaction.code !== 'P') return
    const existing = bySymbol.get(symbol) ?? { name: entry.companyName, buyers: new Set<string>() }
    existing.buyers.add(transaction.insiderName)
    bySymbol.set(symbol, existing)
  })

  return [...bySymbol.entries()]
    .map(([symbol, { name, buyers }]) => ({ symbol, name, buyerCount: buyers.size }))
    .filter((s) => s.buyerCount >= minBuyers)
    .sort((a, b) => b.buyerCount - a.buyerCount)
}
```

Note: `fetch` inside a CIK-resolution rejection is already handled by `.catch(() => null)` on `getTickerByCik` — this guards against `getTickerByCik` itself throwing (it should not, per Task 1, but a mocked rejection in a future test must not crash the batch).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/edgar-form4-feed.test.ts`
Expected: PASS (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add lib/edgar-form4-feed.ts tests/lib/edgar-form4-feed.test.ts
git commit -m "feat: orchestrate EDGAR Form4 cluster seed discovery"
```

---

## Task 5: New seed source in `lib/discover.ts`

**Files:**
- Modify: `lib/discover.ts:92-145` (`CandidateSeed`, `addSeed`, `sourceCandidates`)
- Test: `tests/lib/discover.test.ts`

**Interfaces:**
- Consumes: `getForm4ClusterSeeds` from `@/lib/edgar-form4-feed` (Task 4).
- Produces: `CandidateSeed` gains `clusterBuyerCount: number | null` — used by Task 6.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/discover.test.ts`, inside the existing `describe('sourceCandidates', ...)` block (needs a new import at the top: `import * as edgarForm4Feed from '@/lib/edgar-form4-feed'`):

```typescript
it('adds a cluster-only seed from EDGAR Form4 with no price/change data', async () => {
  vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
  vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
  vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([])
  vi.spyOn(market, 'getMarketBigMovers').mockResolvedValue([])
  vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockResolvedValue([{ symbol: 'ACME', name: 'Acme Corp', buyerCount: 3 }])

  const seeds = await sourceCandidates(new Set())

  expect(seeds).toHaveLength(1)
  expect(seeds[0]).toMatchObject({ symbol: 'ACME', name: 'Acme Corp', market: 'US', source: ['edgar-form4-cluster'], seedPrice: null, seedChangePct: null, congressScore: null, clusterBuyerCount: 3 })
})

it('merges an EDGAR cluster signal onto a symbol already found by movers, without duplicating it', async () => {
  vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
  vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
  vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([])
  vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
    m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, exchange: null }] : []
  )
  vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockResolvedValue([{ symbol: 'MSFT', name: 'Microsoft Corp', buyerCount: 2 }])

  const seeds = await sourceCandidates(new Set())

  expect(seeds).toHaveLength(1)
  expect(seeds[0].source.sort()).toEqual(['edgar-form4-cluster', 'yahoo-movers-us'])
  expect(seeds[0].clusterBuyerCount).toBe(2)
})

it('does not let a failing EDGAR cluster source block the other sources', async () => {
  vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
  vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
  vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([])
  vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
    m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, exchange: null }] : []
  )
  vi.spyOn(edgarForm4Feed, 'getForm4ClusterSeeds').mockRejectedValue(new Error('SEC down'))

  const seeds = await sourceCandidates(new Set())

  expect(seeds.map((s) => s.symbol)).toEqual(['MSFT'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/discover.test.ts -t "EDGAR"`
Expected: FAIL — `seeds` has length 0 / `clusterBuyerCount` is `undefined` (source and field do not exist yet).

- [ ] **Step 3: Implement**

In `lib/discover.ts`:

1. Add the import (after the existing `./finnhub`/`./insider-data` imports, around line 7):

```typescript
import { getForm4ClusterSeeds } from './edgar-form4-feed'
```

2. Replace the `CandidateSeed` interface (lines 92-100):

```typescript
export interface CandidateSeed {
  symbol: string
  name: string
  market: 'US' | 'IT'
  source: string[]
  seedPrice: number | null
  seedChangePct: number | null
  congressScore: number | null
  clusterBuyerCount: number | null
}
```

3. Replace the `addSeed` closure (lines 105-115) to accept and merge the new field:

```typescript
  function addSeed(symbol: string, name: string, market: 'US' | 'IT', source: string, seedPrice: number | null, seedChangePct: number | null, congressScore: number | null, clusterBuyerCount: number | null = null) {
    const existing = seedMap.get(symbol)
    if (existing) {
      if (!existing.source.includes(source)) existing.source.push(source)
      if (existing.seedPrice === null) existing.seedPrice = seedPrice
      if (existing.seedChangePct === null) existing.seedChangePct = seedChangePct
      if (existing.congressScore === null) existing.congressScore = congressScore
      if (existing.clusterBuyerCount === null) existing.clusterBuyerCount = clusterBuyerCount
    } else {
      seedMap.set(symbol, { symbol, name, market, source: [source], seedPrice, seedChangePct, congressScore, clusterBuyerCount })
    }
  }
```

4. Add a fourth sourcing block, after the IT movers block (after line 140, before the final `return`):

```typescript
  try {
    const clusters = await getForm4ClusterSeeds()
    for (const c of clusters) addSeed(c.symbol, c.name, 'US', 'edgar-form4-cluster', null, null, null, c.buyerCount)
  } catch (err) {
    console.error('Discovery: EDGAR Form4 cluster sourcing failed:', err instanceof Error ? err.message : String(err))
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/discover.test.ts`
Expected: PASS — all tests, including the 3 new ones. (The pre-existing `selectForEnrichment` `seed()` test helper now needs `congressScore: null, clusterBuyerCount: null` — TypeScript will flag the missing field as a compile error; fix the helper now so this task's `tsc`/test run is green, since Task 6 also touches it: in `tests/lib/discover.test.ts`, update `function seed(...)` to return `{ symbol, name: symbol, market, source: ['yahoo-movers-us'], seedPrice: 10, seedChangePct: 20, congressScore: null, clusterBuyerCount: null }`.)

- [ ] **Step 5: Commit**

```bash
git add lib/discover.ts tests/lib/discover.test.ts
git commit -m "feat: source discovery candidates from EDGAR Form4 insider clusters"
```

---

## Task 6: Reserve 4 slots for cluster-only candidates in `selectForEnrichment`

**Files:**
- Modify: `lib/discover.ts:147-149` (`selectForEnrichment`)
- Test: `tests/lib/discover.test.ts`

**Interfaces:**
- Consumes: `CandidateSeed.clusterBuyerCount` (Task 5).
- Produces: no change to `selectForEnrichment`'s exported signature.

- [ ] **Step 1: Write the failing test**

Replace the existing `describe('selectForEnrichment', ...)` block in `tests/lib/discover.test.ts` (it currently has 2 tests; the first one's expectation changes under the new reserved-slot behavior, so this step edits it in place rather than only adding):

```typescript
describe('selectForEnrichment', () => {
  function seed(symbol: string, market: 'US' | 'IT', overrides: Partial<CandidateSeed> = {}): CandidateSeed {
    return { symbol, name: symbol, market, source: ['yahoo-movers-us'], seedPrice: 10, seedChangePct: 20, congressScore: null, clusterBuyerCount: null, ...overrides }
  }
  function clusterOnlySeed(symbol: string, buyerCount: number): CandidateSeed {
    return { symbol, name: symbol, market: 'US', source: ['edgar-form4-cluster'], seedPrice: null, seedChangePct: null, congressScore: null, clusterBuyerCount: buyerCount }
  }

  it('takes the full 14 US and 6 IT from movers/congress when there are no cluster-only candidates', () => {
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

  it('reserves up to 4 slots for cluster-only candidates, shrinking the general pool to 10', () => {
    const movers = [...Array(20)].map((_, i) => seed(`US${i}`, 'US'))
    const clusters = [clusterOnlySeed('C1', 5), clusterOnlySeed('C2', 4), clusterOnlySeed('C3', 3), clusterOnlySeed('C4', 2)]
    const result = selectForEnrichment([...movers, ...clusters])
    const us = result.filter((s) => s.market === 'US')
    expect(us).toHaveLength(14)
    expect(us.filter((s) => s.source.includes('edgar-form4-cluster')).map((s) => s.symbol).sort()).toEqual(['C1', 'C2', 'C3', 'C4'])
  })

  it('keeps only the top 4 cluster-only candidates by buyerCount when more than 4 are available', () => {
    const movers = [...Array(20)].map((_, i) => seed(`US${i}`, 'US'))
    const clusters = [clusterOnlySeed('LOW1', 2), clusterOnlySeed('HIGH1', 9), clusterOnlySeed('LOW2', 2), clusterOnlySeed('HIGH2', 8), clusterOnlySeed('HIGH3', 7), clusterOnlySeed('HIGH4', 6)]
    const result = selectForEnrichment([...movers, ...clusters])
    const chosenClusters = result.filter((s) => s.source.includes('edgar-form4-cluster')).map((s) => s.symbol)
    expect(chosenClusters.sort()).toEqual(['HIGH1', 'HIGH2', 'HIGH3', 'HIGH4'])
  })

  it('does not hand unused reserved slots to movers when fewer than 4 cluster-only candidates exist', () => {
    const movers = [...Array(20)].map((_, i) => seed(`US${i}`, 'US'))
    const clusters = [clusterOnlySeed('C1', 5)]
    const result = selectForEnrichment([...movers, ...clusters])
    const us = result.filter((s) => s.market === 'US')
    expect(us).toHaveLength(11) // 10 general + 1 cluster, the other 3 reserved slots stay empty
    expect(us.some((s) => s.symbol === 'C1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/discover.test.ts -t selectForEnrichment`
Expected: FAIL — the 3 new tests fail (current implementation always returns a plain `slice(0, maxUS)`, so cluster-only seeds at the bottom of the sort order never appear).

- [ ] **Step 3: Implement**

Replace `lib/discover.ts:147-149`:

```typescript
export function selectForEnrichment(seeds: CandidateSeed[], maxUS = 14, maxIT = 6): CandidateSeed[] {
  const clusterReserved = Math.min(4, maxUS)
  const generalCap = maxUS - clusterReserved

  const us = seeds.filter((s) => s.market === 'US')
  const clusterOnly = us
    .filter((s) => s.source.length === 1 && s.source[0] === 'edgar-form4-cluster')
    .sort((a, b) => (b.clusterBuyerCount ?? 0) - (a.clusterBuyerCount ?? 0))
    .slice(0, clusterReserved)
  const clusterOnlySymbols = new Set(clusterOnly.map((s) => s.symbol))
  const general = us.filter((s) => !clusterOnlySymbols.has(s.symbol)).slice(0, generalCap)

  const it = seeds.filter((s) => s.market === 'IT').slice(0, maxIT)

  return [...general, ...clusterOnly, ...it]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/discover.test.ts`
Expected: PASS — full file green (all `scoreCandidate`, `sourceCandidates`, `selectForEnrichment`, `runDiscoveryScan` tests).

- [ ] **Step 5: Commit**

```bash
git add lib/discover.ts tests/lib/discover.test.ts
git commit -m "feat: reserve 4 US slots for EDGAR cluster-only candidates"
```

---

## Task 7: Full suite, manual EDGAR smoke test, and duration check

**Files:** none modified — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no regressions anywhere else in the app.

- [ ] **Step 2: Run the type checker**

Run: `npx tsc --noEmit`
Expected: no errors (confirms the `CandidateSeed`/`addSeed`/test-helper field additions are consistent everywhere, including `app/` call sites if any reference `CandidateSeed` by shape).

- [ ] **Step 3: Confirm the real EDGAR "getcurrent" feed and filing format still match what Tasks 2-4 assume**

The parser was written from SEC's documented Atom feed and Form 4 XML schema, not from a live fetch (the sandbox used to write this plan was blocked by SEC's bot filter, returning an "Undeclared Automated Tool" page instead of the feed). Run this from a machine/CI with normal SEC access, with a short pause between the two requests:

```bash
curl -s -A "any-stock/1.0 (personal watchlist app)" \
  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=5&output=atom" \
  -o /tmp/form4-feed-sample.xml
cat /tmp/form4-feed-sample.xml
```

Check: the output is XML (not an HTML "Undeclared Automated Tool" or rate-limit page), and each `<entry>` has a `<title>` shaped like `4 - COMPANY NAME (0000000001) (Reporting)` and an `<id>` containing `accession-number=...`. If the shape differs, adjust the regexes in `parseFeedEntries` (Task 2) accordingly and re-run its tests.

Then, picking one `accessionNumber` and `cik` from that output:

```bash
sleep 1
curl -s -A "any-stock/1.0 (personal watchlist app)" \
  "https://www.sec.gov/Archives/edgar/data/<cik>/<accession-no-dashes>/primary_doc.xml"
```

Check: this returns the Form 4 XML (not a 404). If it 404s, the `primary_doc.xml` filename assumption (Task 4) is wrong for that filing — in that case, fetching `https://data.sec.gov/submissions/CIK<cik, 10-digit zero-padded>.json` and reading `filings.recent.primaryDocument` for the matching `accessionNumber` (the same technique already used in `lib/edgar-roles.ts`'s `getInsiderRoles`) gives the real filename; if this turns out to be the common case rather than the exception, that lookup should be folded into `getForm4ClusterSeeds` before shipping.

- [ ] **Step 4: Time a real scan**

With the app running against real Finnhub/SEC credentials (not mocked), trigger `POST /api/discover` and time it:

```bash
time curl -s -X POST http://localhost:3000/api/discover
```

Check: completes well under 60 seconds (the `maxDuration` already set on `app/api/discover/route.ts`). If it runs close to the limit, lower the Task 4 `limit` parameter (e.g. from 100 to 50) rather than changing the route's `maxDuration`.

- [ ] **Step 5: Commit the verification note**

No code change is expected from this task unless Step 3 or Step 4 found a real discrepancy (in which case, fix it in the relevant task's file and commit that fix with its own message instead of this one). If everything matched:

```bash
git commit --allow-empty -m "chore: verify EDGAR Form4 cluster feed against live SEC endpoints"
```
